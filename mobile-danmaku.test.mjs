import assert from 'node:assert/strict';
import {installMobileDanmaku} from './src/views/Play/mobile-danmaku.js';
class Element {
  constructor(tag) {this.tag=tag;this.children=[];this.style={};this.attrs={};this.events={};}
  append(...nodes) {for(const node of nodes){node.parent=this;this.children.push(node);}}
  setAttribute(name,value) {this.attrs[name]=value;}
  addEventListener(name,fn) {this.events[name]=fn;}
  contains(node) {return this===node || this.children.some(child=>child.contains(node));}
  focus() {this.focused=true;}
  remove() {if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);}
  fire(name) {this.events[name]?.({target:this,stopPropagation(){}});}
}
const doc={createElement:tag=>new Element(tag)};
const classes=new Set(['fnos-touch-player']);
const player=new Element('player');player.clientHeight=220;player.clientWidth=390;player.classList={contains:name=>classes.has(name)};
const events=new Map();let outside,toolbar;
const option={visible:true,opacity:1,fontSize:25,speed:5,antiOverlap:true,synchronousPlayback:false,modes:[0,1,2],margin:[10,'25%']};
const plugin={option,get isHide(){return !option.visible;},config(patch){Object.assign(option,patch);art.emit('artplayerPluginDanmuku:config');}};
const settingsItems=new Map();let resized=0;
const art={template:{$player:player},plugins:{artplayerPluginDanmuku:plugin},setting:{show:false,add(item){settingsItems.set(item.name,item);},remove(name){settingsItems.delete(name);},resize(){resized++;}},controls:{show:true},layers:{add({html}){toolbar=html;player.append(html);}},proxy(target,name,fn){outside=fn;},on(name,fn){events.set(name,fn);},off(name){events.delete(name);},emit(name,...args){events.get(name)?.(...args);}};
const dispose=installMobileDanmaku(art,doc);
const [toggle,settings,panel]=toolbar.children;
assert.equal(toggle.attrs['aria-label'],'关闭弹幕');toggle.fire('click');assert.equal(option.visible,false);assert.equal(toggle.attrs['aria-pressed'],'false');
plugin.config({visible:true});assert.equal(toggle.attrs['aria-label'],'关闭弹幕');
plugin.config({fontSize:'2.5%'});assert.equal(panel.children[1].children[2].value,10);plugin.config({fontSize:25});
settings.fire('click');assert.equal(art.setting.show,true);assert.equal(resized,1);
settingsItems.get('mobile-danmaku-settings').onClick();assert.equal(panel.hidden,false);assert.equal(art.setting.show,false);assert.equal(settings.attrs['aria-expanded'],'true');assert.equal(art.isInput,true);assert.equal(panel.style.maxHeight,'148px');
const opacity=panel.children[0].children[2];opacity.value='0.4';opacity.fire('input');assert.equal(option.opacity,0.4);assert.equal(panel.children[0].children[1].textContent,'40%');
const overlap=panel.children[3].children[1];overlap.checked=false;overlap.fire('change');assert.equal(option.antiOverlap,false);
art.emit('control',false);assert.equal(toolbar.style.display,'','Portrait controls stay accessible');assert.equal(panel.hidden,false);
outside({target:player});assert.equal(panel.hidden,true);assert.equal(art.isInput,false);
classes.add('fnos-mobile-fullscreen');settings.fire('click');art.emit('control',false);assert.equal(toolbar.style.display,'none');assert.equal(panel.hidden,true);
art.emit('control',true);assert.equal(toolbar.style.display,'');
dispose();assert.equal(events.size,0);assert.equal(player.children.length,0);assert.equal(settingsItems.size,0);
console.log('PASS: portrait/fullscreen danmaku controls, click settings, plugin state synchronization, configuration updates, panel bounds and cleanup');
