import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parsePosition} from './validation.ts';

test('pozisyon gereksinimleri tam ağırlık ve doğru alanlar ister',()=>{
  const valid=parsePosition({title:'Yazılım geliştirici',description:'Web uygulamaları geliştirme ve bakım.',requirements:[{label:'TypeScript',weight:60,required:true},{label:'SQL',weight:40,required:false}]});
  assert.equal(valid.requirements.length,2);
  assert.throws(()=>parsePosition({...valid,requirements:[{label:'SQL',weight:90,required:true}]}),/100/);
  assert.throws(()=>parsePosition({...valid,requirements:[{label:'SQL',weight:-1,required:true}]}),/geçersiz/);
  assert.throws(()=>parsePosition({...valid,requirements:[]}),/yetkinlik/);
});
