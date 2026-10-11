import { start } from "./start";

const instance = await start(process.env);
console.log(
  `denarii listening on port ${instance.port} (Telegram ${instance.runtime.config.TELEGRAM_MODE})`,
);

instance.polling.catch(async (error: unknown) => {
  console.error("Telegram polling stopped", error);
  await instance.stop();
  process.exit(1);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    await instance.stop();
    process.exit(0);
  });
}
