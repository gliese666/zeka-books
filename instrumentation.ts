/**
 * Next.js instrumentation hook — запускает worker автоматически при старте сервера.
 * Работает только в Node.js runtime (не Edge).
 *
 * Поток:
 *   npm run dev  →  Next.js старт  →  instrumentation.ts  →  worker/index.ts
 *
 * Worker подхватывает только job'ы в статусе 'queued'.
 * Пока пользователь не нажал ▶ Запустить — worker ничего не трогает.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { spawn } = await import('child_process');
  const { resolve } = await import('path');

  const root = resolve(process.cwd());
  const tsx = resolve(root, 'node_modules/.bin/tsx');
  const workerScript = resolve(root, 'worker/index.ts');

  let restarting = false;

  function startWorker() {
    if (restarting) return;

    const child = spawn(tsx, ['--no-cache', '--env-file=.env.local', workerScript], {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env },
    });

    child.on('exit', (code) => {
      // Graceful shutdown (SIGINT/SIGTERM) → code 0 → не рестартуем
      if (code === 0 || restarting) return;
      console.log(`\n[instrumentation] Worker завершился (code ${code}). Перезапуск через 5s...`);
      setTimeout(startWorker, 5000);
    });

    // При остановке веб-сервера убиваем worker вместе с ним
    for (const sig of ['SIGINT', 'SIGTERM'] as const) {
      process.on(sig, () => {
        restarting = true;
        child.kill(sig);
      });
    }
  }

  startWorker();
}
