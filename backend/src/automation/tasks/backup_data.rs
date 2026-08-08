use crate::automation::execution_log;
use crate::automation::traits::AutomationTaskHandler;
use crate::config::BackupStorageConfig;
use crate::state::AppState;
use anyhow::{Context, Result};
use futures_util::future::{BoxFuture, FutureExt};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct BackupDataParams {
    #[serde(default)]
    components: Vec<String>,
    #[serde(default)]
    storage: BackupStorageConfig,
}

pub struct BackupDataHandler;

impl AutomationTaskHandler for BackupDataHandler {
    fn task_type(&self) -> &'static str {
        "backup_data"
    }

    fn execute<'a>(
        &'a self,
        app: &'a AppState,
        params: &'a serde_json::Value,
    ) -> BoxFuture<'a, Result<()>> {
        async move {
            let task_params: BackupDataParams =
                serde_json::from_value(params.clone()).context("解析备份任务参数失败")?;

            execution_log::append(
                app,
                params,
                format!(
                    "开始备份 {} 个组件到 {}",
                    task_params.components.len(),
                    task_params.storage.local_dir
                ),
            );

            crate::backup::write_automation_backup(
                app,
                &task_params.components,
                &task_params.storage.local_dir,
            )
            .map(|_| ())
            .map_err(|err| anyhow::anyhow!(err))
            .context("执行备份数据任务失败")?;

            execution_log::append(app, params, "备份数据已完成");
            Ok(())
        }
        .boxed()
    }
}
