import { expect, test } from '@playwright/test';
import { es } from '../src/i18n/es';
import { zh } from '../src/i18n/zh';
import { loginEmployee, loginOwner, watchProblems } from './helpers';

const unique = () => String(Date.now()).slice(-6);

test('fichar en la caja sin internet (también quien no cobra) y el dueño lo ve en Horarios', async ({ page, context }) => {
  const problems = watchProblems(page);
  await loginOwner(page);
  const username = `lucas${unique()}`;
  expect((await page.request.post('/api/users', { data: { name: 'Lucas', username, pin: '2468', perms: ['stock'] } })).ok()).toBe(true);

  await page.goto('/pos');
  await page.getByRole('button', { name: zh.pos.linkThisPc }).click();
  await page.getByRole('button', { name: zh.pos.clockInOut }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Lucas' }).click();
  for (const d of '2468') await dialog.getByRole('button', { name: d, exact: true }).click();
  await dialog.getByRole('button', { name: '✓' }).click();
  await context.setOffline(true);
  await dialog.getByRole('button', { name: zh.pos.clockIn }).click();
  await expect(page.getByText(zh.pos.pendingSync.replace('{{count}}', '1'))).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText(zh.pos.synced)).toBeVisible({ timeout: 30_000 });

  await expect
    .poll(async () => ((await (await page.request.get('/api/attendance/today')).json()) as { working: { name: string }[] }).working.map((w) => w.name))
    .toContain('Lucas');
  await page.goto('/attendance');
  await expect(page.getByRole('heading', { name: zh.attendance.title })).toBeVisible();
  await expect(page.locator('.attendance-row', { hasText: 'Lucas' })).toContainText(zh.attendance.working);
  // Sin internet el navegador avisa en la consola que no pudo sincronizar: es lo esperado.
  expect(problems.filter((p) => !p.includes('ERR_INTERNET_DISCONNECTED'))).toEqual([]);
});

test('el empleado ficha entrada y salida desde el celular', async ({ page: owner, browser }) => {
  await loginOwner(owner);
  const username = `nora${unique()}`;
  expect((await owner.request.post('/api/users', { data: { name: 'Nora', username, pin: '1357', perms: ['sell'] } })).ok()).toBe(true);

  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const problems = watchProblems(page);
  await loginEmployee(page, username, '1357');
  await expect(page.getByText(es.attendance.notClocked)).toBeVisible();
  await page.getByRole('button', { name: es.attendance.clockIn }).click();
  await expect(page.getByText(es.attendance.workingSince.split('{{')[0])).toBeVisible();
  await page.getByRole('button', { name: es.attendance.clockOut }).click();
  await expect(page.getByText(es.attendance.leftAt.split('{{')[0])).toBeVisible();
  expect(problems).toEqual([]);
});

test('el dueño carga la ficha y el horario de un empleado', async ({ page }) => {
  const problems = watchProblems(page);
  await loginOwner(page);
  await page.goto('/team');
  await page.locator('.card', { hasText: '@sofia' }).getByRole('button', { name: zh.team.ficha }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(zh.team.dni).fill('40.111.222');
  await dialog.getByLabel(`${zh.team.days.d1} ${zh.attendance.in}`).fill('09:00');
  await dialog.getByLabel(`${zh.team.days.d1} ${zh.attendance.out}`).fill('17:00');
  await dialog.getByRole('button', { name: zh.common.save }).click();
  await expect(dialog).toBeHidden();

  const users = (await (await page.request.get('/api/users')).json()) as { username: string; dni: string; schedule: ({ start: string } | null)[] }[];
  const sofia = users.find((u) => u.username === 'sofia')!;
  expect(sofia.dni).toBe('40.111.222');
  expect(sofia.schedule[1]).toEqual({ start: '09:00', end: '17:00' });
  expect(problems).toEqual([]);
});
