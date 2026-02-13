/**
 * Учёт заработка по неделям (как в anchor).
 * Новая неделя = новая строка с weekly_earnings=0. Cron не нужен.
 */
import { supabase } from '../db/supabase.js';

function getWeekStartDate(): string {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Понедельник = 1
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - diff);
  weekStart.setHours(0, 0, 0, 0);
  return weekStart.toISOString().split('T')[0];
}

export async function findOrCreateCompanyEarnings(companyId: string): Promise<{ weeklyEarnings: number }> {
  const weekStartDate = getWeekStartDate();

  const { data: existing } = await supabase
    .from('company_earnings')
    .select('weekly_earnings')
    .eq('company_id', companyId)
    .eq('week_start_date', weekStartDate)
    .single();

  if (existing) {
    return { weeklyEarnings: existing.weekly_earnings ?? 0 };
  }

  await supabase.from('company_earnings').insert({
    company_id: companyId,
    week_start_date: weekStartDate,
    weekly_earnings: 0,
  });

  return { weeklyEarnings: 0 };
}

export async function addWeeklyEarnings(companyId: string, amount: number): Promise<void> {
  const weekStartDate = getWeekStartDate();

  const { data: existing } = await supabase
    .from('company_earnings')
    .select('id, weekly_earnings')
    .eq('company_id', companyId)
    .eq('week_start_date', weekStartDate)
    .single();

  if (existing) {
    await supabase
      .from('company_earnings')
      .update({ weekly_earnings: (existing.weekly_earnings ?? 0) + amount })
      .eq('id', existing.id);
  } else {
    await supabase.from('company_earnings').insert({
      company_id: companyId,
      week_start_date: weekStartDate,
      weekly_earnings: amount,
    });
  }
}

export async function getWeeklyEarnings(companyId: string): Promise<number> {
  const { weeklyEarnings } = await findOrCreateCompanyEarnings(companyId);
  return weeklyEarnings;
}
