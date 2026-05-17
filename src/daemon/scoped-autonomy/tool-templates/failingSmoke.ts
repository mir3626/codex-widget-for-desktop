export const FAILING_SMOKE_TOOL = String.raw`
process.stdin.resume();
process.stdin.on("end", () => {
  process.stdout.write(JSON.stringify({ ok: false, error: "intentional_first_smoke_failure" }));
  process.exitCode = 1;
});
`;
