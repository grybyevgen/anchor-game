import { Router, Request, Response } from 'express';
import { supabase } from '../db/supabase.js';
import { addWeeklyEarnings } from '../services/companyEarnings.js';
import { requireSessionToken } from '../middleware/auth.js';

const router = Router();
router.use(requireSessionToken);

const DAILY_TEMPLATES = [
  { task_key: 'daily-trips-1', title: 'Совершить 2 рейса', description: 'Доставьте груз между портами', type: 'daily' as const, target: 2, reward: 500, icon: 'trips' },
  { task_key: 'daily-cargo-1', title: 'Перевезти 50 единиц груза', description: 'Перевезите любой тип груза', type: 'daily' as const, target: 50, reward: 300, icon: 'cargo' },
  { task_key: 'daily-coins-1', title: 'Заработать 1000 монет', description: 'Получите доход от продажи груза', type: 'daily' as const, target: 1000, reward: 200, icon: 'coins' },
];

const WEEKLY_TEMPLATES = [
  { task_key: 'weekly-trips-1', title: 'Совершить 15 рейсов', description: 'Доставьте груз между портами', type: 'weekly' as const, target: 15, reward: 2000, icon: 'trips' },
  { task_key: 'weekly-ships-1', title: 'Купить 2 судна', description: 'Расширьте свой флот', type: 'weekly' as const, target: 2, reward: 1500, icon: 'ship' },
  { task_key: 'weekly-cargo-1', title: 'Перевезти 300 единиц груза', description: 'Перевезите любой тип груза', type: 'weekly' as const, target: 300, reward: 1800, icon: 'cargo' },
];

const MONTHLY_TEMPLATES = [
  { task_key: 'monthly-trips-1', title: 'Совершить 100 рейсов', description: 'Доставьте груз между портами', type: 'monthly' as const, target: 100, reward: 10000, icon: 'trips' },
  { task_key: 'monthly-coins-1', title: 'Накопить 50000 монет', description: 'Достигните этой суммы на счету', type: 'monthly' as const, target: 50000, reward: 5000, icon: 'coins' },
  { task_key: 'monthly-ships-1', title: 'Владеть 5 суднами', description: 'Соберите флот из 5 судов', type: 'monthly' as const, target: 5, reward: 8000, icon: 'ship' },
];

/** Start of current day in UTC (00:00:00.000). */
function startOfTodayUTC(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** Start of current week (Monday) in UTC. */
function startOfWeekUTC(): Date {
  const d = new Date();
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday = 1
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** Start of current month in UTC. */
function startOfMonthUTC(): Date {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Remove unclaimed tasks that are from a previous period (day/week/month).
 * After this, ensureTasks will create new tasks for the current period.
 */
async function resetExpiredTasks(companyId: string): Promise<void> {
  const dayStart = startOfTodayUTC();
  const weekStart = startOfWeekUTC();
  const monthStart = startOfMonthUTC();

  const { data: existing } = await supabase
    .from('tasks')
    .select('id, type, created_at')
    .eq('company_id', companyId)
    .is('claimed_at', null);

  if (!existing?.length) return;

  const toDelete: string[] = [];
  for (const t of existing) {
    const created = new Date(t.created_at);
    if (t.type === 'daily' && created < dayStart) toDelete.push(t.id);
    else if (t.type === 'weekly' && created < weekStart) toDelete.push(t.id);
    else if (t.type === 'monthly' && created < monthStart) toDelete.push(t.id);
  }

  if (toDelete.length) {
    await supabase.from('tasks').delete().in('id', toDelete);
  }
}

async function ensureTasks(companyId: string, company: { completed_trips: number; coins: number }, shipCount: number, totalCargo: number) {
  const now = new Date();
  const { data: existing } = await supabase
    .from('tasks')
    .select('task_key, type, created_at')
    .eq('company_id', companyId);

  const existingKeys = new Set((existing || []).map((t) => t.task_key));
  const toInsert: Array<Record<string, any>> = [];

  for (const t of DAILY_TEMPLATES) {
    if (!existingKeys.has(t.task_key)) {
      let progress = 0;
      if (t.task_key.includes('trips')) progress = Math.min(company.completed_trips, t.target);
      else if (t.task_key.includes('coins')) progress = Math.min(company.coins, t.target);
      else if (t.task_key.includes('cargo')) progress = Math.min(totalCargo, t.target);
      toInsert.push({
        company_id: companyId,
        task_key: t.task_key,
        title: t.title,
        description: t.description,
        type: t.type,
        progress,
        target: t.target,
        reward: t.reward,
        completed: progress >= t.target,
      });
    }
  }
  for (const t of WEEKLY_TEMPLATES) {
    if (!existingKeys.has(t.task_key)) {
      let progress = 0;
      if (t.task_key.includes('trips')) progress = Math.min(company.completed_trips, t.target);
      else if (t.task_key.includes('ships')) progress = Math.min(shipCount, t.target);
      else if (t.task_key.includes('cargo')) progress = Math.min(totalCargo, t.target);
      toInsert.push({
        company_id: companyId,
        task_key: t.task_key,
        title: t.title,
        description: t.description,
        type: t.type,
        progress,
        target: t.target,
        reward: t.reward,
        completed: progress >= t.target,
      });
    }
  }
  for (const t of MONTHLY_TEMPLATES) {
    if (!existingKeys.has(t.task_key)) {
      let progress = 0;
      if (t.task_key.includes('trips')) progress = Math.min(company.completed_trips, t.target);
      else if (t.task_key.includes('coins')) progress = Math.min(company.coins, t.target);
      else if (t.task_key.includes('ships')) progress = Math.min(shipCount, t.target);
      toInsert.push({
        company_id: companyId,
        task_key: t.task_key,
        title: t.title,
        description: t.description,
        type: t.type,
        progress,
        target: t.target,
        reward: t.reward,
        completed: progress >= t.target,
      });
    }
  }

  if (toInsert.length) {
    await supabase.from('tasks').insert(toInsert);
  }
}

/**
 * GET /api/tasks
 * List tasks for company. Progress is synced from company stats.
 * Daily/weekly/monthly tasks are reset when their period has passed (on each request).
 */
router.get('/', async (req: Request & { companyId?: string }, res: Response) => {
  try {
    const companyId = req.companyId!;

    const { data: company } = await supabase
      .from('companies')
      .select('completed_trips, coins, total_cargo_units')
      .eq('id', companyId)
      .single();

    if (!company) {
      res.status(404).json({ error: 'Company not found' });
      return;
    }

    const { count: shipCount } = await supabase
      .from('ships')
      .select('*', { count: 'exact', head: true })
      .eq('company_id', companyId);

    const totalCargo = company.total_cargo_units ?? 0;

    await resetExpiredTasks(companyId);
    await ensureTasks(companyId, {
      completed_trips: company.completed_trips,
      coins: company.coins,
    }, shipCount ?? 0, totalCargo);

    const { data: tasks } = await supabase
      .from('tasks')
      .select('*')
      .eq('company_id', companyId)
      .is('claimed_at', null);

    // Update progress from current stats
    const updated = (tasks || []).map((t) => {
      let progress = t.progress;
      if (t.task_key?.includes('trips')) progress = Math.min(company.completed_trips, t.target);
      else if (t.task_key?.includes('coins')) progress = Math.min(company.coins, t.target);
      else if (t.task_key?.includes('ships')) progress = Math.min(shipCount ?? 0, t.target);
      else if (t.task_key?.includes('cargo')) progress = Math.min(totalCargo, t.target);
      return { ...t, progress, completed: progress >= t.target };
    });

    // Persist progress updates
    for (const t of updated) {
      await supabase
        .from('tasks')
        .update({ progress: t.progress, completed: t.completed })
        .eq('id', t.id);
    }

    res.json({
      tasks: updated.map((t) => ({
        id: t.id,
        taskKey: t.task_key,
        title: t.title,
        description: t.description,
        type: t.type,
        progress: t.progress,
        target: t.target,
        reward: t.reward,
        completed: t.completed,
        icon: t.task_key?.includes('trips') ? 'trips' : t.task_key?.includes('cargo') ? 'cargo' : t.task_key?.includes('ships') ? 'ship' : 'coins',
      })),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/tasks/:id/claim
 * Claim task reward. Removes task (or marks claimed).
 */
router.post('/:id/claim', async (req: Request & { companyId?: string }, res: Response) => {
  try {
    const companyId = req.companyId!;
    const taskId = req.params.id;

    const { data: task } = await supabase
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .eq('company_id', companyId)
      .single();

    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    if (task.claimed_at) {
      res.status(400).json({ error: 'Already claimed' });
      return;
    }

    if (!task.completed) {
      res.status(400).json({ error: 'Task not completed' });
      return;
    }

    const { data: company } = await supabase
      .from('companies')
      .select('coins')
      .eq('id', companyId)
      .single();

    if (!company) {
      res.status(500).json({ error: 'Company not found' });
      return;
    }

    await supabase
      .from('tasks')
      .update({ claimed_at: new Date().toISOString() })
      .eq('id', taskId);

    await addWeeklyEarnings(companyId, task.reward);

    await supabase
      .from('companies')
      .update({ coins: company.coins + task.reward })
      .eq('id', companyId);

    res.json({ ok: true, reward: task.reward, newCoins: company.coins + task.reward });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
