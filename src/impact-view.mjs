import path from 'node:path';
import { escape as e, markdown } from './specs.mjs';
import { isTestFile } from './impact.mjs';

export function renderImpactPanel({ file, evidence, result, jobs, preview, base }, { icon, link }) {
  const fileLabel = target => `<span class="impact-node-icon">${icon('file')}</span><span class="impact-node-label"><strong>${e(path.posix.basename(target))}</strong><small>${e(path.posix.dirname(target) === '.' ? '/' : path.posix.dirname(target) + '/')}</small></span>${isTestFile(target) ? '<span class="impact-node-tag">Test</span>' : ''}`;
  const related = target => result.changes.some(change => change.file === target)
    ? link(`${fileLabel(target)}${icon('chevron')}`, { ...base, file: target }, 'impact-file-link', `title="Open diff for ${e(target)}"`)
    : `<span class="impact-file-path" title="${e(target)}">${fileLabel(target)}</span>`;
  const fileList = entries => `<ul class="impact-tree">${entries.map(entry => {
    const target = typeof entry === 'string' ? entry : entry.file;
    return `<li class="impact-node">${related(target)}${entry.state && entry.state !== 'retained' ? `<span class="impact-dependency-state ${entry.state}">${e(entry.state)}</span>` : ''}${entry.via ? `<span class="impact-via">via <span title="${e(entry.via)}">${e(entry.via)}</span></span>` : ''}</li>`;
  }).join('')}</ul>`;
  const group = (name, id, entries, open = false) => `<details class="impact-relation-group" id="${id}" ${open ? 'open' : ''}><summary>${icon('chevron')}<span>${name}</span><span class="impact-group-count">${entries.length}</span></summary>${fileList(entries)}</details>`;
  const selected = `<div class="impact-focus-file"><span class="impact-focus-icon">${icon('git')}</span><div><strong>${e(path.posix.basename(file.file))}</strong><span title="${e(file.file)}">${e(path.posix.dirname(file.file) === '.' ? '/' : path.posix.dirname(file.file) + '/')}</span></div><span class="impact-file-state">${e(file.type)}</span></div>`;
  let body;
  if (evidence.error) body = `<p class="error-message">${e(evidence.error)}</p>`;
  else {
    const summary = evidence.summary;
    const exports = summary.removedExports.length || summary.addedExports.length ? `<div class="impact-api-changes" aria-label="Detected export changes">${summary.removedExports.length ? `<div><span class="impact-api-label removed">Removed exports</span><div>${summary.removedExports.map(name => `<code>${e(name)}</code>`).join('')}</div></div>` : ''}${summary.addedExports.length ? `<div><span class="impact-api-label added">Added exports</span><div>${summary.addedExports.map(name => `<code>${e(name)}</code>`).join('')}</div></div>` : ''}</div>` : '';
    const notes = evidence.unresolved.length + evidence.skipped + evidence.unsupported + Number(summary.wildcard);
    const coverage = `<details class="impact-coverage" id="impact-coverage"><summary><span>Scan coverage</span><span class="impact-coverage-count">${notes ? `${notes} ${notes === 1 ? 'note' : 'notes'}` : 'Details'}</span>${icon('chevron')}</summary><div><p>${e(evidence.scope)}</p>${summary.wildcard ? '<p>Wildcard re-exports are not expanded into individual export names.</p>' : ''}${evidence.skipped ? `<p><strong>${evidence.skipped}</strong> source scans skipped files over 500 KB.</p>` : ''}${evidence.unsupported ? `<p><strong>${evidence.unsupported}</strong> unsupported preview files retain baseline references.</p>` : ''}${evidence.unresolved.length ? `<p><strong>${evidence.unresolved.length}</strong> unresolved local references across this preview.</p><ul>${evidence.unresolved.slice(0, 8).map(item => `<li><span>${e(item.reference)}</span><small>in ${e(item.file)}</small></li>`).join('')}</ul>${evidence.unresolved.length > 8 ? '<p>Showing the first 8 unresolved references.</p>' : ''}` : ''}</div></details>`;
    body = `<div class="impact-auto-summary"><p class="impact-summary-title">${e(summary.title)}</p><p class="impact-summary-text">${e(summary.text)}</p>${summary.tests.length ? `<span class="impact-test-hint">${icon('file')}${summary.tests.length} related test ${summary.tests.length === 1 ? 'file' : 'files'}</span>` : ''}</div>${exports}<div class="impact-relations">${evidence.direct.length ? group('Direct consumers', 'impact-direct', evidence.direct, true) : ''}${evidence.transitive.length ? group('Downstream', 'impact-downstream', evidence.transitive) : ''}${evidence.dependencies.length ? group('Imports & assets', 'impact-imports', evidence.dependencies) : ''}${!summary.dependentCount && !evidence.dependencies.length ? '<p class="impact-empty-note">No local dependency links were resolved for this file.</p>' : ''}</div>${coverage}`;
  }
  const analysisJobs = jobs.filter(item => item.action === 'impact' && item.reviewPreview === preview && item.reviewFile === file.file);
  const report = analysisJobs.find(item => item.status === 'completed' && item.analysis);
  const pending = analysisJobs.find(item => ['queued', 'running', 'awaiting-input'].includes(item.status));
  const previousAnalysis = `${pending ? `<p class="review-hint">An earlier agent analysis is ${e(pending.status)}.</p>` : ''}${report ? `<details class="impact-report" id="impact-report"><summary>Previous agent report</summary><div class="prose small">${markdown(report.analysis)}</div></details>` : ''}`;
  return `<section class="inspector-section file-impact-section" id="file-impact"><div class="section-title impact-panel-title"><h2>File impact</h2><span class="impact-auto-label" title="Computed from this preview’s source and dependency graph">${icon(evidence.error ? 'clock' : 'check')}${evidence.error ? 'Unavailable' : 'Automatic'}</span></div>${selected}${body}${previousAnalysis}</section>`;
}
