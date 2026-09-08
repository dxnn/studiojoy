// The line under the Builder's name while it works (spec/ §8, §9, §17): what
// it says during the sizing call, which streams nothing, and while a file is
// being written, which used to stream nothing either — and that a running
// piece's live line is on the card, not at the foot of the thread. Timing is
// the whole point, so the fake is slow on purpose: a sizing that takes a
// second and a half, a file that arrives over two seconds. The server half is
// test/builder.test.js; this is what a person sees.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signIn } from '../helpers.js';
import { answers, usage } from '../fake-llm.js';
import { openStudio, pageFor } from './browser.js';

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const FILE = 'config/play.js';

// One plan of one piece: the sizing, then a fire that writes the file slowly
// and one that says a word.
function slowBuilder() {
  const calls = [];
  const asked = [];
  return {
    calls,
    asked,
    async complete(opts) {
      asked.push(opts);
      await wait(1500);
      return answers(JSON.stringify({
        size: 'pieces', pieces: [{ title: 'Faster tanks', files: [FILE], what: 'Raise the speed.' }],
      }));
    },
    stream(opts) {
      calls.push(opts);
      const writing = calls.length === 1;
      return (async function* generate() {
        if (writing) {
          yield { type: 'tool_start', index: 0, name: 'write_file', path: FILE };
          await wait(1000);
          yield { type: 'tool_progress', index: 0, name: 'write_file', path: FILE, bytes: 2048 };
          await wait(1000);
          yield { type: 'tool_use', id: 'c0', name: 'write_file', input: { path: FILE, content: 'const TANK_SPEED = 200;' } };
          yield { type: 'end', text: '', finish_reason: 'tool_calls', usage: usage(20) };
        } else {
          yield { type: 'delta', text: 'Faster now.' };
          yield { type: 'end', text: 'Faster now.', finish_reason: 'stop', usage: usage(5) };
        }
      })();
    },
  };
}

test('the line under the Builder says what it is doing, on the card', async (t) => {
  const { app, browser } = await openStudio(t, { llm: slowBuilder() });
  await signIn(app);
  const made = await app.client.json('POST', '/api/projects', { body: { name: 'Tank', slug: 'tank' } });
  const page = await pageFor(browser, app, app.client);
  await page.goto(`${app.base}/p/tank?chat=${made.body.chat.id}`);
  await page.locator('.composer textarea').fill('make the tanks a bit faster');
  await page.locator('.composer button.filled', { hasText: 'Send' }).click();

  // The sizing call streams nothing, so the line says what is happening itself.
  await page.locator('.busy', { hasText: 'working out how big this is' }).waitFor();

  // The file is announced as it arrives, on the card's own line — and nowhere
  // else: every busy line on the page is a piece's.
  await page.locator('.piece-live .busy', { hasText: `writing ${FILE}` }).waitFor();
  assert.equal(await page.locator('.busy').count(), await page.locator('.piece-live .busy').count(),
    'the live line is on the card, not at the foot of the thread');
  await page.locator('.piece-live .busy', { hasText: `writing ${FILE}, 2 KB` }).waitFor();

  // Landed: the card is done and its token note opens the piece's receipt.
  await page.locator('.pieces.done').waitFor();
  const note = page.locator('.tokens button.link');
  await note.waitFor();
  await note.click();
  await page.locator('.receipt').waitFor();
});
