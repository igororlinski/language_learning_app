/** Shared reporting for the test files. Kept dependency-free on purpose. */

let failures = 0;

export function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);

  if (a === e) {
    console.log(`  OK    ${label}`);
    return;
  }

  failures += 1;
  console.log(`  FAIL  ${label}`);
  console.log(`        oczekiwano ${e}`);
  console.log(`        otrzymano  ${a}`);
}

export function group(title: string) {
  console.log(`\n--- ${title} ---\n`);
}

export function failureCount(): number {
  return failures;
}
