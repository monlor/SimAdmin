use crate::db::beijing_sms_now_string;
use crate::state::AppState;
use serde_json::Value;
use tracing::warn;

pub const AUTOMATION_LOG_ID_PARAM: &str = "_automation_log_id";

pub fn timestamped(message: impl AsRef<str>) -> String {
    format!("[{}] {}", beijing_sms_now_string(), message.as_ref())
}

pub fn log_id(params: &Value) -> Option<i64> {
    params.get(AUTOMATION_LOG_ID_PARAM).and_then(Value::as_i64)
}

pub fn append(app: &AppState, params: &Value, message: impl AsRef<str>) {
    if let Some(log_id) = log_id(params) {
        append_by_id(app, log_id, message);
    }
}

pub fn append_by_id(app: &AppState, log_id: i64, message: impl AsRef<str>) {
    let line = timestamped(message);
    if let Err(err) = app.database.append_automation_log_detail(log_id, &line) {
        warn!(log_id, error = %err, "Failed to append automation execution log");
    }
}

pub fn finish(app: &AppState, log_id: i64, status: &str, message: impl AsRef<str>) {
    let line = timestamped(message);
    if let Err(err) = app.database.finish_automation_log(log_id, status, &line) {
        warn!(log_id, error = %err, "Failed to finish automation execution log");
    }
}
