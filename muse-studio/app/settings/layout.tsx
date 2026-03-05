import { AppHeader } from '@/components/layout/AppHeader';
import { SettingsSidebar } from '@/components/settings/SettingsSidebar';

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader />
      <div className="flex flex-1 max-w-5xl mx-auto w-full gap-0 px-6 py-8">
        <SettingsSidebar />
        <div className="w-px bg-white/8 mr-8" />
        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </div>
  );
}
