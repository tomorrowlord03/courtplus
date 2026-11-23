import {
  ArrowUpRight, Bell, BriefcaseBusiness, CalendarDays, Check, Download, FilePenLine, FileSpreadsheet,
  House, LayoutDashboard, Mic, PanelsTopLeft, PanelLeftClose, PanelLeftOpen, Plus, Scale, Search, Settings,
  ShieldCheck, Upload, UserRound, UsersRound, ChartNoAxesColumn,
} from 'lucide-react';

const icons = {
  home: House, calendar: CalendarDays, board: PanelsTopLeft, import: Upload, cases: BriefcaseBusiness,
  people: UsersRound, person: UserRound, drafts: FilePenLine, sheet: FileSpreadsheet, verify: ShieldCheck,
  stats: ChartNoAxesColumn, shield: ShieldCheck, settings: Settings, brand: Scale, expand: PanelLeftOpen,
  collapse: PanelLeftClose, plus: Plus, bell: Bell, search: Search, arrow: ArrowUpRight, check: Check,
  download: Download, dashboard: LayoutDashboard, mic: Mic,
};

export type IconName = keyof typeof icons;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const Glyph = icons[name];
  return <Glyph aria-hidden="true" size={size} strokeWidth={1.8} />;
}
