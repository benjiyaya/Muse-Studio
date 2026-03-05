import { getLLMSettings } from '@/lib/actions/settings';
import { LLMSettings } from '@/components/settings/LLMSettings';

export const dynamic = 'force-dynamic';

export default async function LLMSettingsPage() {
  const settings = await getLLMSettings();
  return <LLMSettings initialSettings={settings} />;
}
