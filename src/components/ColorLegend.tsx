import { Profile, COLOR_PALETTE, isLightColor } from '@/types';
import { getInitials } from '@/lib/dateUtils';

export function ColorLegend({ profiles }: { profiles: Profile[] }) {
  const activeProfiles = profiles.filter(p => p.status === 'active');
  if (activeProfiles.length === 0) return null;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <h3 className="text-sm font-semibold text-slate-700 mb-3">Coworkers</h3>
      <div className="space-y-2">
        {activeProfiles.map(p => {
          const colorName = COLOR_PALETTE.find(c => c.value === p.calendar_color)?.name || 'Custom';
          const light = isLightColor(p.calendar_color);
          return (
            <div key={p.id} className="flex items-center gap-2.5">
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${light ? 'text-slate-800' : 'text-white'}`}
                style={{ backgroundColor: p.calendar_color }}
              >
                {getInitials(p.full_name)}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium text-slate-700 truncate">{p.full_name}</div>
                <div className="text-xs text-slate-400">{colorName}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
