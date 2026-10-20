import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('./src/views/Play/VideoPlayer.vue',import.meta.url),'utf8');
const start=source.indexOf("  art.on('control', (state) => {");
const end=source.indexOf("  art.on('artplayerPluginDanmuku:config'",start);
let handler;let created=0;let titleUpdates=0;
const heading={parentElement:{style:{}}};
let current=heading;
const art={on(name,callback){assert.equal(name,'control');handler=callback;},layers:{update(options){if(options.name==='title')titleUpdates++;if(Object.hasOwn(options,'html'))current=options.html;}}};
vm.runInNewContext(source.slice(start,end),{art,playerHeading:heading,danmuTitleData:{value:{name:'danmuTitle'}},createPlayerHeading(){created++;return {};}});
const pressed=current;
handler(true);handler(false);handler(true);
assert.equal(current,pressed,'The pressed return button must survive control events until pointer release');
assert.equal(created,0,'Control visibility must not recreate the title/button');
console.log('PASS: return button node survives repeated control visibility changes');

assert.equal(titleUpdates,0,'Artplayer update removes and re-adds layers, even without html; visibility must use styles only');
assert.equal(heading.parentElement.style.display,'');
