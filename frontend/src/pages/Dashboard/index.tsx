import { Box, Chip, CircularProgress, Paper, Stack, Typography } from '@mui/material'
import Grid from '@mui/material/Grid'
import {
  CheckCircle,
  FlightTakeoff,
  SignalCellularAlt,
  WifiTethering,
} from '@mui/icons-material'
import { useRefreshInterval } from '@/contexts/RefreshContext'
import ErrorSnackbar from '@/components/ErrorSnackbar'
import { getCarrierLogo, formatCarrierName } from '@/utils/carriers'
import {
  QuickControls,
  SystemResources,
  SimCardInfo,
  RecentSms,
  OperatorManagement,
  NotificationLogs,
  DeviceInfoCard,
  EsimProfileSwitcher,
} from './components'
import { useDashboardData, type DashboardData } from './hooks/useDashboardData'

function getNetworkTech(data: DashboardData) {
  if (data.cellsInfo?.serving_cell?.tech) return data.cellsInfo.serving_cell.tech.toUpperCase()
  const preference = data.networkInfo?.technology_preference?.toLowerCase()
  if (preference?.includes('nr')) return '5G'
  if (preference?.includes('lte')) return 'LTE'
  return 'N/A'
}

function getRegistrationLabel(status?: string) {
  if (status === 'registered') return '已注册'
  if (status === 'roaming') return '漫游'
  return status || '未知'
}

function StatusBar({ data, onError, onEsimSwitched }: {
  data: DashboardData
  onError: (message: string) => void
  onEsimSwitched: () => void
}) {
  const signal = data.networkInfo?.signal_strength ?? 0
  const networkTech = getNetworkTech(data)
  const carrierLogo = getCarrierLogo(data.networkInfo?.mcc, data.networkInfo?.mnc)
  const carrierName = formatCarrierName(data.networkInfo?.mcc, data.networkInfo?.mnc)
  const isAirplaneMode = data.airplaneMode?.enabled ?? false
  return (
    <Paper
      elevation={0}
      sx={{
        p: 2,
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 2,
      }}
    >
      <Stack direction="row" spacing={{ xs: 1, md: 2 }} alignItems="center" flexWrap="wrap" useFlexGap>
        <Box display="flex" alignItems="center" gap={1}>
          <Box sx={{ position: 'relative', width: 12, height: 12 }}>
            <Box
              sx={{
                position: 'absolute',
                inset: 0,
                borderRadius: '50%',
                bgcolor: data.deviceInfo?.online ? 'success.main' : 'error.main',
                opacity: 0.3,
                animation: data.deviceInfo?.online ? 'pulse 1.8s infinite' : 'none',
                '@keyframes pulse': {
                  '0%': { transform: 'scale(1)', opacity: 0.45 },
                  '70%': { transform: 'scale(2.1)', opacity: 0 },
                  '100%': { transform: 'scale(2.1)', opacity: 0 },
                },
              }}
            />
            <Box
              sx={{
                position: 'absolute',
                inset: 2,
                borderRadius: '50%',
                bgcolor: data.deviceInfo?.online ? 'success.main' : 'error.main',
              }}
            />
          </Box>
          <Typography variant="subtitle2" fontWeight={800}>
            {data.deviceInfo?.online ? '系统在线' : '系统离线'}
          </Typography>
        </Box>

        {!isAirplaneMode && (
          <>
            <Box display="flex" alignItems="center" gap={1}>
              {carrierLogo ? (
                <Box component="img" src={carrierLogo} alt={carrierName} sx={{ height: 24, maxWidth: 92, objectFit: 'contain' }} />
              ) : (
                <Chip label={carrierName} size="small" variant="outlined" />
              )}
              <Chip
                icon={<SignalCellularAlt />}
                label={`${signal}%`}
                color={signal > 70 ? 'success' : signal > 35 ? 'primary' : 'warning'}
                size="small"
                variant="outlined"
              />
            </Box>
            <Chip icon={<WifiTethering />} label={networkTech} color={networkTech === '5G' ? 'success' : 'primary'} size="small" />
            <Chip
              icon={<CheckCircle />}
              label={getRegistrationLabel(data.networkInfo?.registration_status)}
              color={data.networkInfo?.registration_status === 'registered' ? 'success' : 'default'}
              size="small"
              variant="outlined"
            />
          </>
        )}
        {isAirplaneMode && <Chip icon={<FlightTakeoff />} label="飞行模式" color="warning" size="small" />}
        <Typography variant="caption" color="text.disabled">
          | 运行 {data.systemStats?.uptime?.uptime_formatted || '-'}
        </Typography>
      </Stack>

      <EsimProfileSwitcher onError={onError} onSwitched={onEsimSwitched} />
    </Paper>
  )
}

export default function DashboardPage() {
  const { refreshInterval, refreshKey } = useRefreshInterval()
  const { initialLoading, profileSwitching, error, setError, data, actions } = useDashboardData(refreshInterval, refreshKey)

  if (initialLoading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="60vh">
        <CircularProgress />
      </Box>
    )
  }

  if (profileSwitching) {
    return (
      <Box display="flex" flexDirection="column" justifyContent="center" alignItems="center" gap={2} minHeight="60vh">
        <CircularProgress />
        <Typography variant="h6">SIM 切换中</Typography>
        <Typography color="text.secondary">正在切换 Profile 并恢复基带与网络，请稍候</Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ maxWidth: 1600, mx: 'auto' }}>
      <ErrorSnackbar error={error} onClose={() => setError(null)} />

      <Stack spacing={2}>
        <StatusBar
          data={data}
          onError={setError}
          onEsimSwitched={() => window.setTimeout(() => void actions.loadData(), 1_000)}
        />

        <Grid container spacing={2}>
          <Grid size={{ xs: 12, md: 6, lg: 3 }}>
            <QuickControls
              dataStatus={data.dataStatus}
              airplaneMode={data.airplaneMode}
              roaming={data.roaming}
              onToggleData={() => void actions.toggleData()}
              onToggleAirplaneMode={() => void actions.toggleAirplaneMode()}
              onToggleRoaming={() => void actions.toggleRoaming()}
            />
          </Grid>

          <Grid size={{ xs: 12, md: 6, lg: 3 }}>
            <SimCardInfo simInfo={data.simInfo} onRefresh={() => void actions.loadData()} />
          </Grid>

          <Grid size={{ xs: 12, lg: 6 }}>
            <RecentSms refreshInterval={refreshInterval} refreshKey={refreshKey} />
          </Grid>

          <Grid size={{ xs: 12, lg: 6 }}>
            <OperatorManagement refreshInterval={refreshInterval} refreshKey={refreshKey} />
          </Grid>

          <Grid size={{ xs: 12, lg: 6 }}>
            <DeviceInfoCard deviceInfo={data.deviceInfo} systemStats={data.systemStats} />
          </Grid>

          <Grid size={{ xs: 12, lg: 6 }}>
            <NotificationLogs refreshInterval={refreshInterval} refreshKey={refreshKey} />
          </Grid>

          <Grid size={{ xs: 12, lg: 6 }}>
            <SystemResources systemStats={data.systemStats} />
          </Grid>
        </Grid>
      </Stack>
    </Box>
  )
}
