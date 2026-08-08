use crate::automation::tasks::TaskRegistry;
use crate::automation::{execution_log, execution_log::AUTOMATION_LOG_ID_PARAM};
use crate::config::{AutomationAction, AutomationTask, AutomationTrigger};
use crate::db::beijing_sms_now_string;
use crate::notification::AutomationEvent;
use crate::state::AppState;
use anyhow::Result;
use chrono::{DateTime, Datelike, FixedOffset, Utc};
use std::collections::HashMap;
use std::sync::Arc;
use tracing::{error, info, warn};

fn beijing_offset() -> FixedOffset {
    FixedOffset::east_opt(8 * 60 * 60).unwrap()
}

fn beijing_now() -> DateTime<FixedOffset> {
    Utc::now().with_timezone(&beijing_offset())
}

fn interval_task_due(task: &AutomationTask, now: DateTime<Utc>) -> bool {
    task.next_run_at
        .as_deref()
        .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
        .is_some_and(|next| now >= next.with_timezone(&Utc))
}

pub fn spawn_automation_scheduler(app: AppState) {
    tokio::spawn(async move {
        info!("Starting automation center scheduler...");
        let registry = Arc::new(TaskRegistry::new());

        // 用于防止定点定时任务在同一分钟内重复运行
        // 键为 task_id，值为执行时的分钟数字符串，例如 "2026-06-10 04:00"
        let mut fixed_last_run: HashMap<String, String> = HashMap::new();

        loop {
            // 每隔 30 秒执行一次评估
            tokio::time::sleep(tokio::time::Duration::from_secs(30)).await;

            let config = app.config_manager.get_automation_config();
            if !config.enabled {
                continue;
            }

            for task in config.tasks {
                if !task.enabled {
                    continue;
                }

                // 判断是否应当触发
                let should_trigger = match &task.trigger {
                    AutomationTrigger::Fixed { weekdays, times } => {
                        let now = beijing_now();
                        let day_of_week = now.weekday().number_from_monday() as u8; // 1 to 7
                        let current_minute_str = now.format("%H:%M").to_string();

                        if weekdays.contains(&day_of_week) && times.contains(&current_minute_str) {
                            let unique_minute = now.format("%Y-%m-%d %H:%M").to_string();
                            // 检查是否在此分钟内已经运行过
                            if fixed_last_run.get(&task.id) == Some(&unique_minute) {
                                false
                            } else {
                                fixed_last_run.insert(task.id.clone(), unique_minute);
                                true
                            }
                        } else {
                            false
                        }
                    }
                    AutomationTrigger::Interval {
                        interval_value: _,
                        interval_unit: _,
                    } => interval_task_due(&task, Utc::now()),
                };

                if should_trigger {
                    let Some(run_guard) = app.automation_task_runs.try_start(&task.id) else {
                        info!(
                            task_id = %task.id,
                            task_name = %task.name,
                            "Automation task is already running; skipping duplicate trigger"
                        );
                        continue;
                    };
                    if let Err(err) = app.config_manager.mark_automation_task_triggered(&task.id) {
                        warn!(
                            task_id = %task.id,
                            error = %err,
                            "Failed to persist next automation run time"
                        );
                    }
                    let registry_clone = registry.clone();
                    let app_clone = app.clone();
                    let task_clone = task.clone();

                    tokio::spawn(async move {
                        let _run_guard = run_guard;
                        if let Err(e) =
                            execute_task(&app_clone, &registry_clone, &task_clone, "自动调度").await
                        {
                            error!("Automation task {} failed: {:?}", task_clone.id, e);
                        }
                    });
                }
            }

            // 定期执行自动清理策略 (清理旧的自动化日志)
            let config_notifications = app.config_manager.get_notifications();
            let cleanup = config_notifications.log_cleanup;
            let retention_days = if cleanup.retention_days_enabled {
                Some(cleanup.retention_days)
            } else {
                None
            };
            let max_entries = if cleanup.max_entries_enabled {
                Some(cleanup.max_entries)
            } else {
                None
            };
            if retention_days.is_some() || max_entries.is_some() {
                let _ = app
                    .database
                    .cleanup_automation_logs(retention_days, max_entries);
            }
        }
    });
}

pub(crate) async fn execute_task(
    app: &AppState,
    registry: &TaskRegistry,
    task: &AutomationTask,
    trigger_source: &str,
) -> Result<()> {
    info!("Triggering automation task: {} ({})", task.name, task.id);

    let task_type = match &task.action {
        AutomationAction::RestartBaseband => "restart_baseband",
        AutomationAction::RebootDevice { .. } => "reboot_device",
        AutomationAction::BackupData { .. } => "backup_data",
        AutomationAction::SendSms { .. } => "send_sms",
    };

    let start_detail = execution_log::timestamped(format!("任务开始（{trigger_source}）"));
    let log_id = app.database.insert_automation_log(
        &task.id,
        &task.name,
        task_type,
        "running",
        &start_detail,
    )?;

    let handler = match registry.get(task_type) {
        Some(h) => h,
        None => {
            let err_msg = format!("未找到任务处理器：{}", task_type);
            execution_log::finish(app, log_id, "failed", &err_msg);
            return Err(anyhow::anyhow!(err_msg));
        }
    };

    let mut handler_manages_timeout = false;
    // 参数转换
    let mut params = match &task.action {
        AutomationAction::RestartBaseband => serde_json::json!({}),
        AutomationAction::RebootDevice { delay_seconds } => {
            serde_json::json!({ "delay_seconds": delay_seconds })
        }
        AutomationAction::BackupData {
            components,
            storage,
        } => {
            serde_json::json!({
                "components": components,
                "storage": storage,
            })
        }
        AutomationAction::SendSms {
            phone_number,
            content,
            source_iccid,
            random_delay_seconds,
            retry_limit,
        } => {
            handler_manages_timeout = true;
            serde_json::json!({
                "phone_number": phone_number,
                "content": content,
                "source_iccid": source_iccid,
                "random_delay_seconds": random_delay_seconds,
                "retry_limit": retry_limit
            })
        }
    };
    params
        .as_object_mut()
        .expect("automation task parameters must be an object")
        .insert(
            AUTOMATION_LOG_ID_PARAM.to_string(),
            serde_json::json!(log_id),
        );
    execution_log::append_by_id(app, log_id, "任务参数已加载，开始执行");

    // SMS owns bounded timeouts for confirmation, retries, eSIM switching and
    // recovery internally. Do not cancel it from outside before it can finish
    // retries or restore the original Profile.
    let result = if handler_manages_timeout {
        Ok(handler.execute(app, &params).await)
    } else {
        tokio::time::timeout(
            tokio::time::Duration::from_secs(60),
            handler.execute(app, &params),
        )
        .await
    };

    let (status, detail) = match result {
        Ok(Ok(_)) => ("success", "任务执行成功".to_string()),
        Ok(Err(e)) => ("failed", format!("任务执行失败：{}", e)),
        Err(_) => ("failed", "任务执行超时（超过 60 秒限制）".to_string()),
    };

    // 更新同一条 SQLite 日志，确保前端能看到完整的执行生命周期。
    execution_log::finish(app, log_id, status, &detail);

    // 2. 发出通知事件
    let event = AutomationEvent {
        task_id: task.id.clone(),
        task_name: task.name.clone(),
        task_type: task_type.to_string(),
        status: status.to_string(),
        message: detail.clone(),
        timestamp: beijing_sms_now_string(),
    };

    if let Err(e) = app
        .notification_sender
        .forward_automation_event(&event)
        .await
    {
        warn!("Failed to forward automation notification event: {:?}", e);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn interval_task(next_run_at: &str) -> AutomationTask {
        AutomationTask {
            id: "task-1".to_string(),
            name: "Task".to_string(),
            enabled: true,
            next_run_at: Some(next_run_at.to_string()),
            trigger: AutomationTrigger::Interval {
                interval_value: 30,
                interval_unit: "days".to_string(),
            },
            action: AutomationAction::RestartBaseband,
        }
    }

    #[test]
    fn interval_task_only_becomes_due_at_persisted_next_run() {
        let now = DateTime::parse_from_rfc3339("2026-08-09T00:00:00Z")
            .unwrap()
            .with_timezone(&Utc);

        assert!(!interval_task_due(
            &interval_task("2026-08-10T00:00:00Z"),
            now
        ));
        assert!(interval_task_due(
            &interval_task("2026-08-08T00:00:00Z"),
            now
        ));
    }
}
