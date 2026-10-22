import assert from 'node:assert/strict';
import {renderDanmaku, emojiImageUrl} from './src/views/Play/danmaku-renderer.js';
class Node {
  constructor(tag, text = '') {this.tag = tag; this.textContent = text; this.children = []; this.style = {};}
  append(...children) {this.children.push(...children);}
  replaceChildren(fragment) {this.children = fragment.children;}
  set innerHTML(_) {throw new Error('Untrusted HTML entered the parser');}
}
const doc = {createElement: tag => new Node(tag), createTextNode: text => new Node('#text', text),
  createDocumentFragment: () => new Node('#fragment')};
const attack = '<img src=x onerror="alert(1)">';
const node = new Node('span', attack + '[笑][笑][坏]');
renderDanmaku(node, {'[笑]': 'https://i0.hdslb.com/emoji.png', '[坏]': 'javascript:alert(1)'}, doc);
assert.equal(node.children[0].textContent, attack);
assert.equal(node.children.filter(child => child.tag === 'img').length, 2);
assert.equal(node.children.at(-1).textContent, '[坏]');
assert.equal(node.children[1].src, 'https://i0.hdslb.com/emoji.png');
assert.equal(node.children[1].referrerPolicy, 'no-referrer');
for (const value of ['data:image/svg+xml,x', 'https://hdslb.com.evil.invalid/a', 'https://hdslb.com@evil.invalid/a',
  'http://127.0.0.1/a', 'https://i0.hdslb.com:8443/a', 'javascript:alert(1)', null]) assert.equal(emojiImageUrl(value), null);
assert.equal(emojiImageUrl('//i0.hdslb.com/a'), 'https://i0.hdslb.com/a');
const plain = new Node('span', attack);
renderDanmaku(plain, {}, doc);
assert.equal(plain.children[0].textContent, attack);
console.log('PASS: literal markup, repeated emoji, URL restrictions and DOM-only rendering');
