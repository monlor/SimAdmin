use crate::automation::execution_log;
use crate::automation::traits::AutomationTaskHandler;
use crate::db::beijing_sms_now_string;
use crate::handlers::{enable_esim_profile_for_switch, EsimProfileEnableOutcome};
use crate::modem_manager::{
    power_cycle_sim_for_profile_switch, send_sms_confirmed, wait_for_registered_network_ready,
};
use crate::state::AppState;
use crate::system_event::mask_identifier;
use crate::utils::normalize_iccid;
use anyhow::{anyhow, bail, Context, Result};
use ring::rand::{SecureRandom, SystemRandom};
use std::sync::atomic::Ordering;
use std::time::Duration;
use tracing::{info, warn};

pub struct SendSmsHandler;

const NETWORK_REGISTRATION_TIMEOUT_SECS: u64 = 90;
const NETWORK_STABILITY_WAIT_SECS: u64 = 10;
const SMS_CONFIRM_TIMEOUT_SECS: u64 = 60;

fn profile_is_active(state: &str) -> bool {
    matches!(
        state.trim().to_ascii_lowercase().as_str(),
        "enabled" | "active" | "1" | "true"
    )
}

async fn prepare_profile_transaction(app: &AppState, target_iccid: &str) -> Result<Option<String>> {
    let target = normalize_iccid(target_iccid);
    if target.is_empty() {
        bail!("发送号码对应的 eSIM ICCID 无效");
    }

    let profiles = app
        .esim_supervisor
        .get_profiles_for_switch()
        .await
        .map_err(|err| anyhow!("读取 eSIM Profile 失败：{}", err.message()))?
        .profiles;
    if !profiles
        .iter()
        .any(|profile| normalize_iccid(&profile.iccid) == target)
    {
        bail!("发送号码对应的 eSIM Profile 不存在，请刷新后重新选择");
    }

    let active = profiles
        .iter()
        .find(|profile| profile_is_active(&profile.state));
    if active.is_some_and(|profile| normalize_iccid(&profile.iccid) == target) {
        return Ok(None);
    }

    let original_iccid = active
        .map(|profile| profile.iccid.trim().to_string())
        .filter(|iccid| !iccid.is_empty())
        .context("无法识别当前启用的 eSIM Profile，为避免发送后无法恢复，已取消切换")?;
    Ok(Some(original_iccid))
}

async fn enable_profile_and_wait_for_network(app: &AppState, iccid: &str) -> Result<()> {
    match enable_esim_profile_for_switch(app, iccid).await {
        Ok(EsimProfileEnableOutcome::Enabled(_)) => {
            let auto_connect_data = !app.data_user_disabled.load(Ordering::SeqCst);
            let allow_roaming = app.config_manager.get_roaming_allowed();
            let apn_config = app.config_manager.get_apn_config();
            power_cycle_sim_for_profile_switch(
                &app.dbus_conn,
                auto_connect_data,
                allow_roaming,
                Some(apn_config),
            )
            .await
            .map_err(|err| anyhow!("eSIM 切换后的基带恢复失败：{err}"))?;
        }
        Ok(EsimProfileEnableOutcome::AlreadyEnabled(_)) => {}
        Ok(EsimProfileEnableOutcome::Failed(response)) => {
            bail!("eSIM Profile 切换失败：{}", response.msg)
        }
        Err(err) => bail!("eSIM Profile 切换失败：{}", err.message()),
    }

    let registration = wait_for_registered_network_ready(
        &app.dbus_conn,
        Duration::from_secs(NETWORK_REGISTRATION_TIMEOUT_SECS),
    )
    .await
    .map_err(|err| anyhow!("eSIM Profile 切换后未能驻网：{err}"))?;
    info!(iccid = %mask_identifier(iccid), %registration, "eSIM profile registered on network");
    Ok(())
}

async fn wait_for_stable_network(app: &AppState) -> Result<()> {
    info!(
        "Network registered; waiting {} seconds before sending automation SMS",
        NETWORK_STABILITY_WAIT_SECS
    );
    tokio::time::sleep(Duration::from_secs(NETWORK_STABILITY_WAIT_SECS)).await;
    wait_for_registered_network_ready(&app.dbus_conn, Duration::from_secs(10))
        .await
        .map(|_| ())
        .map_err(|err| anyhow!("驻网稳定等待后信号已丢失：{err}"))
}

async fn request_original_profile_restore(app: &AppState, iccid: &str) -> Result<()> {
    info!(
        iccid = %mask_identifier(iccid),
        "Requesting original eSIM profile restore after automation SMS"
    );
    app.esim_supervisor
        .enable_profile(iccid.to_string())
        .await
        .map(|_| ())
        .map_err(|err| anyhow!("恢复原 eSIM Profile 请求失败：{}", err.message()))
}

fn finish_sms_task(send_result: Result<()>, restore_result: Result<()>) -> Result<()> {
    if let Err(err) = restore_result {
        warn!(
            error = %err,
            "Ignoring original eSIM profile restore failure after automation SMS"
        );
    }
    send_result
}

async fn send_with_confirmation_and_retries(
    app: &AppState,
    params: &serde_json::Value,
    phone_number: &str,
    content: &str,
    retry_limit: u32,
) -> Result<()> {
    let mut attempts = 0;
    loop {
        attempts += 1;
        execution_log::append(
            app,
            params,
            format!(
                "正在发送短信（第 {attempts}/{} 次）",
                retry_limit.saturating_add(1)
            ),
        );
        match send_sms_confirmed(
            &app.dbus_conn,
            phone_number,
            content,
            Duration::from_secs(SMS_CONFIRM_TIMEOUT_SECS),
        )
        .await
        {
            Ok(_) => {
                info!(
                    attempts,
                    "Automation SMS confirmed sent to {}", phone_number
                );
                execution_log::append(app, params, "短信已确认发送成功");
                return Ok(());
            }
            Err(err) => {
                warn!(
                    attempts,
                    "Automation SMS to {} failed: {}", phone_number, err
                );
                if attempts > retry_limit {
                    execution_log::append(
                        app,
                        params,
                        format!("短信发送失败，已达到重试上限：{err}"),
                    );
                    return Err(anyhow!(err)).context("短信发送失败 (已达重试上限)");
                }
                execution_log::append(app, params, format!("本次发送失败，5 秒后重试：{err}"));
                tokio::time::sleep(Duration::from_secs(5)).await;
                if let Err(registration_err) =
                    wait_for_registered_network_ready(&app.dbus_conn, Duration::from_secs(45)).await
                {
                    warn!(
                        attempts,
                        "Network was not registered before SMS retry: {}", registration_err
                    );
                    execution_log::append(
                        app,
                        params,
                        format!("重试前仍未恢复驻网：{registration_err}"),
                    );
                } else {
                    execution_log::append(app, params, "重试前已确认网络驻网");
                }
            }
        }
    }
}

fn generate_random_string(len: usize) -> String {
    let rng = SystemRandom::new();
    let mut bytes = vec![0u8; len];
    if rng.fill(&mut bytes).is_ok() {
        const CHARS: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
        bytes
            .iter()
            .map(|&b| CHARS[(b as usize) % CHARS.len()] as char)
            .collect()
    } else {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let mut s = String::new();
        let mut val = now;
        for _ in 0..len {
            let idx = (val % 62) as usize;
            const CHARS: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
            s.push(CHARS[idx] as char);
            val /= 62;
        }
        s
    }
}

fn get_random_u32(max: u32) -> u32 {
    if max == 0 {
        return 0;
    }
    let rng = SystemRandom::new();
    let mut bytes = [0u8; 4];
    if rng.fill(&mut bytes).is_ok() {
        u32::from_be_bytes(bytes) % max
    } else {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        (now % max as u128) as u32
    }
}

use futures_util::future::{BoxFuture, FutureExt};

impl AutomationTaskHandler for SendSmsHandler {
    fn task_type(&self) -> &'static str {
        "send_sms"
    }

    fn execute<'a>(
        &'a self,
        app: &'a AppState,
        params: &'a serde_json::Value,
    ) -> BoxFuture<'a, Result<()>> {
        let phone_number = match params
            .get("phone_number")
            .and_then(|v| v.as_str())
            .context("缺少接收号码")
        {
            Ok(pn) => pn.to_string(),
            Err(e) => return async move { Err(e) }.boxed(),
        };

        let content_template = match params
            .get("content")
            .and_then(|v| v.as_str())
            .context("缺少短信内容")
        {
            Ok(c) => c.to_string(),
            Err(e) => return async move { Err(e) }.boxed(),
        };

        let random_delay_seconds = params
            .get("random_delay_seconds")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as u32;

        let retry_limit = params
            .get("retry_limit")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as u32;

        let source_iccid = params
            .get("source_iccid")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);

        async move {
            // 1. 随机延迟机制
            if random_delay_seconds > 0 {
                let delay = get_random_u32(random_delay_seconds);
                info!("Sms task delayed by {} seconds before sending", delay);
                execution_log::append(app, params, format!("随机延迟 {delay} 秒后开始处理"));
                tokio::time::sleep(tokio::time::Duration::from_secs(delay as u64)).await;
            } else {
                execution_log::append(app, params, "无需随机延迟");
            }

            // 2. 渲染模板变量
            let time_str = beijing_sms_now_string();
            let rand_str = generate_random_string(6);
            let rendered_content = content_template
                .replace("{{时间}}", &time_str)
                .replace("{{随机字符串}}", &rand_str);
            execution_log::append(app, params, "短信模板已生成");

            // 3. Serialize the switch/send/restore-request transaction. The
            // restore command is best-effort and does not wait for registration.
            let _profile_switch_guard = if source_iccid.is_some() {
                execution_log::append(app, params, "正在等待 eSIM 切换锁");
                Some(app.esim_profile_switch_lock.lock().await)
            } else {
                None
            };

            let original_iccid = if let Some(target_iccid) = source_iccid.as_deref() {
                execution_log::append(
                    app,
                    params,
                    format!(
                        "正在读取 eSIM Profile，目标 ICCID {}",
                        mask_identifier(target_iccid)
                    ),
                );
                let original = prepare_profile_transaction(app, target_iccid).await?;
                if original.is_some() {
                    execution_log::append(app, params, "目标号码与当前号码不同，需要切换 Profile");
                } else {
                    execution_log::append(app, params, "目标号码已是当前启用号码，无需切换");
                }
                original
            } else {
                execution_log::append(app, params, "使用当前已启用号码发送");
                None
            };

            // Once the original Profile is known, keep every subsequent
            // failure inside this result so the restore branch always runs.
            let send_result = async {
                if let Some(target_iccid) = source_iccid.as_deref() {
                    execution_log::append(
                        app,
                        params,
                        if original_iccid.is_some() {
                            format!("正在切换到目标 Profile {}", mask_identifier(target_iccid))
                        } else {
                            format!(
                                "正在确认当前目标 Profile {} 的网络状态",
                                mask_identifier(target_iccid)
                            )
                        },
                    );
                    enable_profile_and_wait_for_network(app, target_iccid).await?;
                    execution_log::append(app, params, "目标号码已获取信号并完成驻网");
                    execution_log::append(
                        app,
                        params,
                        format!("等待网络稳定 {NETWORK_STABILITY_WAIT_SECS} 秒"),
                    );
                    wait_for_stable_network(app).await?;
                    execution_log::append(app, params, "网络稳定性检查通过");
                }
                send_with_confirmation_and_retries(
                    app,
                    params,
                    &phone_number,
                    &rendered_content,
                    retry_limit,
                )
                .await
            }
            .await;
            let _ = app.database.insert_sms(
                "outgoing",
                &phone_number,
                &rendered_content,
                if send_result.is_ok() {
                    "sent"
                } else {
                    "failed"
                },
                None,
            );

            let restore_result = if let Some(original_iccid) = original_iccid.as_deref() {
                execution_log::append(
                    app,
                    params,
                    format!(
                        "短信处理完成，正在请求切回原 Profile {}",
                        mask_identifier(original_iccid)
                    ),
                );
                let result = request_original_profile_restore(app, original_iccid).await;
                match &result {
                    Ok(()) => execution_log::append(app, params, "已提交切回原 Profile 请求"),
                    Err(err) => execution_log::append(
                        app,
                        params,
                        format!("切回原 Profile 请求失败（不影响短信发送结果）：{err}"),
                    ),
                }
                result
            } else {
                Ok(())
            };

            // The task result is determined only by confirmed SMS delivery.
            finish_sms_task(send_result, restore_result)
        }
        .boxed()
    }
}

#[cfg(test)]
mod tests {
    use super::finish_sms_task;
    use anyhow::anyhow;

    #[test]
    fn restore_failure_does_not_override_confirmed_sms_success() {
        assert!(finish_sms_task(Ok(()), Err(anyhow!("restore failed"))).is_ok());
    }

    #[test]
    fn sms_failure_remains_the_task_failure() {
        let result = finish_sms_task(Err(anyhow!("send failed")), Ok(()));
        assert_eq!(result.unwrap_err().to_string(), "send failed");
    }
}
