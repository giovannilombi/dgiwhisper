import React from 'react';
import { Zap, Cpu } from 'lucide-react';
import './GpuStatus.css';
import type { GpuInfo } from '../../../../types';
import { useTranslation } from '../../../../i18n';

export interface GpuStatusProps {
  gpuInfo: GpuInfo | null;
}

function GpuStatus({ gpuInfo }: GpuStatusProps): React.JSX.Element | null {
  const { t } = useTranslation();
  if (!gpuInfo) return null;

  const ariaKey = gpuInfo.available ? 'settings.gpu.ariaEnabled' : 'settings.gpu.ariaDisabled';

  return (
    <div
      className={`gpu-status ${gpuInfo.available ? 'gpu-available' : 'gpu-unavailable'}`}
      role="status"
      aria-live="polite"
      aria-label={t(ariaKey, { name: gpuInfo.name })}
    >
      <span className="gpu-icon" aria-hidden="true">
        {gpuInfo.available ? <Zap size={16} /> : <Cpu size={16} />}
      </span>
      <span className="gpu-text">{gpuInfo.name}</span>
    </div>
  );
}

export { GpuStatus };
