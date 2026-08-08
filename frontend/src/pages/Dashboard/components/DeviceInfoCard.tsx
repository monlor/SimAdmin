import { useState } from 'react'
import { Box, Card, CardContent, Typography, IconButton, Tooltip, Chip } from '@mui/material'
import { Router, Visibility, VisibilityOff } from '@mui/icons-material'
import { getSensitiveStyle } from '../utils'
import type { DeviceInfo, SystemStatsResponse } from '@/api/types'

interface DeviceInfoCardProps {
  deviceInfo: DeviceInfo | null
  systemStats: SystemStatsResponse | null
}

export function DeviceInfoCard({ deviceInfo, systemStats }: DeviceInfoCardProps) {
  const [showInfo, setShowInfo] = useState(false)

  return (
    <Card sx={{ height: '100%' }}>
      <CardContent sx={{ height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', py: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Box display="flex" alignItems="center" justifyContent="space-between" mb={1.5}>
          <Box display="flex" alignItems="center" gap={1}>
            <Router fontSize="small" color="primary" />
            <Typography variant="subtitle2" fontWeight="medium">设备信息</Typography>
          </Box>
          <Tooltip title={showInfo ? '隐藏 IMEI' : '显示 IMEI'}>
            <IconButton size="small" onClick={() => setShowInfo(!showInfo)}>
              {showInfo ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
            </IconButton>
          </Tooltip>
        </Box>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(3, minmax(0, 1fr))' },
            columnGap: 2,
            rowGap: 1.25,
            alignContent: 'space-between',
            flex: 1,
            '& > div': { minWidth: 0 },
          }}
        >
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.25, lineHeight: 1 }}>IMEI</Typography>
            <Typography variant="body2" fontFamily="monospace" fontSize="0.78rem" noWrap sx={getSensitiveStyle(showInfo)}>
              {deviceInfo?.imei || 'N/A'}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.25, lineHeight: 1 }}>制造商</Typography>
            <Typography variant="body2" fontSize="0.78rem" noWrap>{deviceInfo?.manufacturer || 'N/A'}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.25, lineHeight: 1 }}>型号</Typography>
            <Typography variant="body2" fontSize="0.78rem" noWrap>{deviceInfo?.model || 'N/A'}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.25, lineHeight: 1 }}>电源状态</Typography>
            <Chip
              label={deviceInfo?.powered ? '已上电' : '未上电'}
              color={deviceInfo?.powered ? 'success' : 'default'}
              size="small"
              sx={{ height: 20, fontSize: '0.7rem' }}
            />
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.25, lineHeight: 1 }}>基带版本</Typography>
            <Typography variant="body2" fontSize="0.78rem" noWrap>
              {deviceInfo?.revision || 'N/A'}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.25, lineHeight: 1 }}>系统</Typography>
            <Typography variant="body2" fontSize="0.78rem" noWrap>
              {systemStats?.system_info?.sysname || '-'} / {systemStats?.system_info?.machine || '-'}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.25, lineHeight: 1 }}>内核</Typography>
            <Typography variant="body2" fontSize="0.78rem" noWrap>
              {systemStats?.system_info?.release || '-'}
            </Typography>
          </Box>
        </Box>
      </CardContent>
    </Card>
  )
}
