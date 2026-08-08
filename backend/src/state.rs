//! 应用状态模块
//! 统一管理应用的共享状态

use axum::extract::FromRef;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Instant;
use tokio::sync::Mutex;
use zbus::Connection;

use crate::cell_lock_store::CellLockStore;
use crate::config::ConfigManager;
use crate::db::Database;
use crate::device_network::DdnsManager;
use crate::esim::EsimSupervisor;
use crate::notification::NotificationSender;
use crate::sms_listener::SmsResyncHandle;
use crate::system_event::SystemEventEmitter;

#[derive(Clone)]
pub struct ActiveCallRecord {
    pub id: i64,
    pub answered_at: Option<Instant>,
    pub answered: bool,
}

/// Tracks automation tasks that are currently executing across scheduler and
/// manual-trigger entry points. The returned guard releases the task ID even
/// when the spawned future is cancelled or unwinds.
#[derive(Clone, Default)]
pub struct AutomationTaskRunTracker {
    running: Arc<StdMutex<HashSet<String>>>,
}

pub struct AutomationTaskRunGuard {
    task_id: String,
    tracker: AutomationTaskRunTracker,
}

impl AutomationTaskRunTracker {
    pub fn try_start(&self, task_id: &str) -> Option<AutomationTaskRunGuard> {
        let mut running = self
            .running
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if !running.insert(task_id.to_string()) {
            return None;
        }
        drop(running);

        Some(AutomationTaskRunGuard {
            task_id: task_id.to_string(),
            tracker: self.clone(),
        })
    }
}

impl Drop for AutomationTaskRunGuard {
    fn drop(&mut self) {
        self.tracker
            .running
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(&self.task_id);
    }
}

/// 应用全局状态
///
/// 统一管理所有共享资源，避免在路由中多次调用 `.with_state()`
#[derive(Clone)]
pub struct AppState {
    /// D-Bus 连接（用于与 ofono 通信）
    pub dbus_conn: Arc<Connection>,
    /// 数据库连接（用于存储 SMS 和通话记录）
    pub database: Arc<Database>,
    /// 配置管理器（用于管理通知等配置）
    pub config_manager: Arc<ConfigManager>,
    /// 通知发送器（用于转发 SMS、通话和 DDNS 通知）
    pub notification_sender: Arc<NotificationSender>,
    pub system_event_emitter: Arc<SystemEventEmitter>,
    pub ddns_manager: Arc<DdnsManager>,
    pub esim_supervisor: Arc<EsimSupervisor>,
    /// Serialize complete eSIM profile switch transactions, including modem
    /// recovery and any temporary-profile SMS operation that must switch back.
    pub esim_profile_switch_lock: Arc<Mutex<()>>,
    /// Prevent the same automation task from being started again before its
    /// current run (including random delay and eSIM restoration) has finished.
    pub automation_task_runs: AutomationTaskRunTracker,
    pub sms_resync: SmsResyncHandle,
    pub sms_db_maintenance_pending: Arc<AtomicBool>,
    pub active_calls: Arc<Mutex<HashMap<String, ActiveCallRecord>>>,
    /// 小区锁定 UI 状态（底层无锁网时仅内存态）
    pub cell_lock: Arc<Mutex<CellLockStore>>,
    /// 用户在界面关闭蜂窝数据后，禁止 init/watchdog 自动再次 Connect。
    pub data_user_disabled: Arc<AtomicBool>,
    pub airplane_mode_requested: Arc<AtomicBool>,
    /// 小区/信号轮询是否已按需唤醒。
    pub cell_monitoring_active: Arc<AtomicBool>,
}

impl AppState {
    /// 创建新的应用状态
    pub fn new(
        dbus_conn: Arc<Connection>,
        database: Arc<Database>,
        config_manager: Arc<ConfigManager>,
        notification_sender: Arc<NotificationSender>,
        system_event_emitter: Arc<SystemEventEmitter>,
        ddns_manager: Arc<DdnsManager>,
        esim_supervisor: Arc<EsimSupervisor>,
        sms_resync: SmsResyncHandle,
        data_user_disabled: Arc<AtomicBool>,
        airplane_mode_requested: Arc<AtomicBool>,
        cell_monitoring_active: Arc<AtomicBool>,
    ) -> Self {
        Self {
            dbus_conn,
            database,
            config_manager,
            notification_sender,
            system_event_emitter,
            ddns_manager,
            esim_supervisor,
            esim_profile_switch_lock: Arc::new(Mutex::new(())),
            automation_task_runs: AutomationTaskRunTracker::default(),
            sms_resync,
            sms_db_maintenance_pending: Arc::new(AtomicBool::new(false)),
            active_calls: Arc::new(Mutex::new(HashMap::new())),
            cell_lock: Arc::new(Mutex::new(CellLockStore::default())),
            data_user_disabled,
            airplane_mode_requested,
            cell_monitoring_active,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::AutomationTaskRunTracker;

    #[test]
    fn automation_task_tracker_rejects_overlap_and_releases_on_drop() {
        let tracker = AutomationTaskRunTracker::default();
        let guard = tracker.try_start("task-1").expect("first run starts");

        assert!(tracker.try_start("task-1").is_none());
        assert!(tracker.try_start("task-2").is_some());

        drop(guard);
        assert!(tracker.try_start("task-1").is_some());
    }
}

// 实现 FromRef trait，允许从 AppState 中提取子状态
// 这样现有的 handler 可以继续使用 State<Arc<Connection>> 等类型

impl FromRef<AppState> for Arc<Connection> {
    fn from_ref(state: &AppState) -> Self {
        state.dbus_conn.clone()
    }
}

impl FromRef<AppState> for Arc<Database> {
    fn from_ref(state: &AppState) -> Self {
        state.database.clone()
    }
}

impl FromRef<AppState> for Arc<ConfigManager> {
    fn from_ref(state: &AppState) -> Self {
        state.config_manager.clone()
    }
}

impl FromRef<AppState> for Arc<NotificationSender> {
    fn from_ref(state: &AppState) -> Self {
        state.notification_sender.clone()
    }
}

impl FromRef<AppState> for Arc<SystemEventEmitter> {
    fn from_ref(state: &AppState) -> Self {
        state.system_event_emitter.clone()
    }
}

impl FromRef<AppState> for Arc<DdnsManager> {
    fn from_ref(state: &AppState) -> Self {
        state.ddns_manager.clone()
    }
}

impl FromRef<AppState> for Arc<EsimSupervisor> {
    fn from_ref(state: &AppState) -> Self {
        state.esim_supervisor.clone()
    }
}

impl FromRef<AppState> for Arc<Mutex<CellLockStore>> {
    fn from_ref(state: &AppState) -> Self {
        state.cell_lock.clone()
    }
}

// 支持 (Arc<Connection>, Arc<Database>) 元组类型
impl FromRef<AppState> for (Arc<Connection>, Arc<Database>) {
    fn from_ref(state: &AppState) -> Self {
        (state.dbus_conn.clone(), state.database.clone())
    }
}
