// Control characters as codepoints rather than escapes, so this file holds
// no invisible bytes.
const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);
const ETX = String.fromCharCode(3); // ctrl-c
const EOT = String.fromCharCode(4); // ctrl-d
const BS = String.fromCharCode(8);
const DEL = String.fromCharCode(127);

// Read a secret without echoing it. When stdin isn't a terminal the whole of
// it is taken as the answer, so `echo hunter2 | npm run adduser -- …` works
// for scripted setup.
export function promptHidden(question) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      let data = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => { data += chunk; });
      process.stdin.on('end', () => resolve(data.replace(/\r?\n$/, '')));
      process.stdin.on('error', reject);
      return;
    }

    process.stdout.write(question);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    let answer = '';
    const cleanup = () => {
      process.stdin.removeListener('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
    };
    const onData = (ch) => {
      if (ch === CR || ch === LF || ch === EOT) {
        cleanup();
        process.stdout.write(LF);
        resolve(answer);
      } else if (ch === ETX) {
        cleanup();
        process.stdout.write(LF);
        reject(new Error('cancelled'));
      } else if (ch === BS || ch === DEL) {
        answer = answer.slice(0, -1);
      } else {
        answer += ch;
      }
    };
    process.stdin.on('data', onData);
  });
}
