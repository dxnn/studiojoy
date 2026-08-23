import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, langFor } from '../public/highlight.js';

// The class of the token whose text contains the snippet — how a test says
// "this word is a keyword" without pinning down token boundaries.
function classOf(tokens, snippet) {
  const hit = tokens.find((t) => t.text.includes(snippet));
  assert.ok(hit, `no token contains ${JSON.stringify(snippet)}`);
  return hit.cls;
}

const joined = (tokens) => tokens.map((t) => t.text).join('');

test('every tokenizer reassembles its input exactly', () => {
  const samples = {
    js: 'const x = `a ${b}` + 0x1f; // done\n/* open',
    css: '@media (a: 1px) { .x { color: #fff; } } /* open',
    html: '<div class="a" data-x>&amp; text <br/> <!-- note',
  };
  for (const [lang, text] of Object.entries(samples)) {
    assert.equal(joined(tokenize(text, lang)), text, lang);
  }
});

test('javascript: comments, strings, numbers and keywords', () => {
  const t = tokenize(
    'const speed = 42; // per second\n'
    + "const name = 'wiggly';\n"
    + 'const msg = `hi ${name}\nsecond line`;\n'
    + '/* block\ncomment */ return player.x;\n',
    'js',
  );
  assert.equal(classOf(t, 'const'), 'kw');
  assert.equal(classOf(t, '42'), 'num');
  assert.equal(classOf(t, '// per second'), 'com');
  assert.equal(classOf(t, "'wiggly'"), 'str');
  // A template string spans its newline and swallows the ${} — a colour, not
  // a parse.
  assert.equal(classOf(t, 'hi ${name}\nsecond line'), 'str');
  assert.equal(classOf(t, 'block\ncomment'), 'com');
  assert.equal(classOf(t, 'return'), 'kw');
  assert.equal(classOf(t, 'player'), null);
});

test('javascript: a string left open stops at the line, a comment does not', () => {
  const t = tokenize("const a = 'oops\nconst b = 1;", 'js');
  assert.equal(classOf(t, "'oops"), 'str');
  assert.equal(classOf(t, 'b'), null);
  const u = tokenize('/* never closed\nstill comment', 'js');
  assert.equal(classOf(u, 'still comment'), 'com');
});

test('css: properties inside a block, not selectors outside one', () => {
  const t = tokenize('.hero { color: #ff0044; margin: 12px; } /* c */ @media print {}', 'css');
  assert.equal(classOf(t, 'hero'), null);
  assert.equal(classOf(t, 'color'), 'attr');
  assert.equal(classOf(t, '#ff0044'), 'num');
  assert.equal(classOf(t, '12px'), 'num');
  assert.equal(classOf(t, '/* c */'), 'com');
  assert.equal(classOf(t, '@media'), 'kw');
});

test('html: tags, attributes, values, comments', () => {
  const t = tokenize('<canvas id="game" hidden></canvas> plain <!-- note -->', 'html');
  assert.equal(classOf(t, '<canvas'), 'tag');
  assert.equal(classOf(t, 'id'), 'attr');
  assert.equal(classOf(t, '"game"'), 'str');
  assert.equal(classOf(t, 'hidden'), 'attr');
  assert.equal(classOf(t, ' plain '), null);
  assert.equal(classOf(t, '<!-- note -->'), 'com');
});

test('html: what sits inside <script> and <style> is the other language', () => {
  const page = '<script>const n = 5; // hi</script><style>.a { color: red; }</style>';
  const t = tokenize(page, 'html');
  assert.equal(joined(t), page);
  assert.equal(classOf(t, 'const'), 'kw');
  assert.equal(classOf(t, '// hi'), 'com');
  assert.equal(classOf(t, 'color'), 'attr');
  // The closing tags are still tags, not swallowed by the inner language.
  assert.equal(classOf(t, '</script'), 'tag');
});

test('langFor maps extensions and leaves the rest plain', () => {
  assert.equal(langFor('js/game.js'), 'js');
  assert.equal(langFor('studio/studio.json'), 'js');
  assert.equal(langFor('css/style.css'), 'css');
  assert.equal(langFor('index.html'), 'html');
  assert.equal(langFor('BRIEF.md'), null);
  assert.equal(langFor('assets/hero.png'), null);
  assert.equal(langFor('no-extension'), null);
});
