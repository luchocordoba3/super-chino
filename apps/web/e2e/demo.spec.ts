import { expect, test } from '@playwright/test';
import { es } from '../src/i18n/es';

test('botón "Probar la demo": entra como empleada con un toque', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: es.login.demoEmployee }).click();
  await expect(page.getByRole('heading', { name: es.home.hello.replace('{{name}}', 'Sofía') })).toBeVisible();
});
