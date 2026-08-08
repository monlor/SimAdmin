use crate::automation::execution_log;
use crate::automation::traits::AutomationTaskHandler;
use crate::modem_manager::restart_baseband;
use crate::state::AppState;
use anyhow::{anyhow, Context, Result};
use futures_util::future::{BoxFuture, FutureExt};
use std::sync::atomic::Ordering;

pub struct BasebandRebootHandler;

impl AutomationTaskHandler for BasebandRebootHandler {
    fn task_type(&self) -> &'static str {
        "restart_baseband"
    }

    fn execute<'a>(
        &'a self,
        app: &'a AppState,
        params: &'a serde_json::Value,
    ) -> BoxFuture<'a, Result<()>> {
        async move {
            execution_log::append(app, params, "正在准备重启基带");
            let auto_connect_data = !app.data_user_disabled.load(Ordering::SeqCst);
            let allow_roaming = app.config_manager.get_roaming_allowed();
            let apn_config = app.config_manager.get_apn_config();

            restart_baseband(
                &app.dbus_conn,
                auto_connect_data,
                allow_roaming,
                Some(apn_config),
            )
            .await
            .map_err(|e| anyhow!("{}", e))
            .context("重启基带失败")?;

            execution_log::append(app, params, "基带重启完成");

            Ok(())
        }
        .boxed()
    }
}
