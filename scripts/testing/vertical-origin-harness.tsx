import React from 'react';
import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {PrintPreview} from '../../src/components/PrintPreview';import {PrintPreview as Before} from './PrintPreview';
import {StaticStagePreview} from '../../src/components/StaticStagePreview';
import {DocumentExportSheet} from '../../src/components/DocumentExportSheet';import {ShareExportModal} from '../../src/components/ShareExportModal';
import {formationExportFixture} from '../../src/utils/formationExportFixture';import {defaultPrintOptions} from '../../src/components/PrintStagePreview';
let root;export function show(kind,origin='top',depth=12.5){if(!root){document.querySelector('#root')?.remove();const host=document.createElement('div');host.id='origin-harness';document.body.append(host);root=createRoot(host);}
const p=formationExportFixture();p.mode='stage';p.useGlobalStageSize=true;p.stage.depthMeters=depth;p.stage.frontDirection='bottom';p.stage.emphasizeVerticalNumbers=true;p.stage.emphasizeVerticalEvery5m=true;p.stage.emphasizeVerticalEvery10m=true;p.frames=p.frames.slice(0,3);
const source=()=>({project:p,projectTitle:p.title,members:p.members,memberGroups:[],objects:p.stageObjects,objectGroups:[],frames:p.frames,currentFrame:p.frames[0],objectStates:{}});
const options={...defaultPrintOptions,verticalOrigin:origin};flushSync(()=>root.render(kind==='before'?<Before project={p}/>:kind==='a4'?<PrintPreview project={p} options={options}/>:kind==='static'?<StaticStagePreview project={p} frame={p.frames[0]} stageWidth={p.stage.widthMeters} range={{left:0,right:p.stage.widthMeters,top:0,bottom:depth}} outputWidth={700} verticalOrigin={origin}/>:kind==='sheet'?<ShareExportModal isOpen projectTitle={p.title} currentSceneLabel='1' onExport={()=>{}} onClose={()=>{}}/>:<ShareExportModal isOpen projectTitle={p.title} currentSceneLabel='1' onExport={()=>{}} onClose={()=>{}}/>));return p;}
