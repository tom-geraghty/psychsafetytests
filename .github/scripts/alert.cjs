// Opens (or updates) one GitHub issue while something is broken, and closes it
// when things recover. The repo owner is assigned, so GitHub emails them.
// Used by the workflows via actions/github-script.
const fs = require('fs');

module.exports = async ({ github, context, core }, { label, title, summaryFile, failed, runUrl }) => {
  const { owner, repo } = context.repo;
  const open = (await github.rest.issues.listForRepo({ owner, repo, state: 'open', labels: label, per_page: 1 })).data[0];
  const summary = fs.existsSync(summaryFile) ? fs.readFileSync(summaryFile, 'utf8') : '_No summary was written: the check itself may have crashed. See the run log._';
  // A fingerprint of what's failing, so we only comment when something changes.
  const failing = summary.split('\n').filter(l => l.startsWith('| ❌')).map(l => l.split('|').slice(2, 5).join('|').trim()).sort().join('\n');
  const marker = `<!-- failing:${require('crypto').createHash('sha1').update(failing).digest('hex')} -->`;

  if (failed) {
    const body = `${summary}\n\n[See the full run](${runUrl})\n${marker}`;
    if (!open) {
      try { await github.rest.issues.createLabel({ owner, repo, name: label, color: 'B3261E' }); } catch (e) { /* exists */ }
      const created = await github.rest.issues.create({ owner, repo, title, body, labels: [label], assignees: [owner] });
      core.notice(`Opened issue #${created.data.number}`);
      return;
    }
    const comments = await github.paginate(github.rest.issues.listComments, { owner, repo, issue_number: open.number, per_page: 100 });
    const last = comments.at(-1)?.body || open.body || '';
    if (!last.includes(marker)) {
      await github.rest.issues.createComment({ owner, repo, issue_number: open.number, body: `Still failing, and something changed:\n\n${body}` });
    }
    return;
  }

  if (open) {
    await github.rest.issues.createComment({ owner, repo, issue_number: open.number, body: `✅ Recovered: everything passed at ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC. [Run](${runUrl})` });
    await github.rest.issues.update({ owner, repo, issue_number: open.number, state: 'closed' });
  }
};
