import { parseHTML } from 'linkedom';
import { setTimeout as delay } from 'node:timers/promises';

// Workflow assertions wait for asynchronous readiness; navigation latency is tested separately.
export async function readyDocument(url) {
  const deadline = Date.now() + 10000;
  for (;;) {
    const response = await fetch(url), html = await response.text();
    if (!response.ok) throw new Error(`GET ${url}: ${html}`);
    const document = parseHTML(html).document;
    if (!document.querySelector('[data-readiness-pending="true"]')) return document;
    if (Date.now() >= deadline) throw new Error('OpenSpec readiness did not settle');
    await delay(40);
  }
}

export async function planningFixture(root, change) {
  const { saveDraft } = await import('../src/drafts.mjs');
  const { writeJSON, runtime } = await import('../src/files.mjs');
  const draft = await saveDraft(root, { change, message: 'Planning fixture' });
  await writeJSON(runtime(root, 'drafts', `${draft.id}.json`), { ...draft, creationId: `fixture-${draft.id}` });
}
