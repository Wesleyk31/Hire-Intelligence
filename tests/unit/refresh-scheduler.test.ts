import { beforeEach, expect, it, vi } from 'vitest';
const state=vi.hoisted(()=>({ rows:[] as any[], reject:false }));
vi.mock('@appdeploy/sdk',()=>({db:{
  list:async()=>({items:structuredClone(state.rows)}),
  add:async(_table:string,rows:any[])=>state.reject?[null]:(state.rows=rows.map(row=>({...row,id:'control'})),['control']),
  update:async(_table:string,items:any[])=>state.reject?[false]:(state.rows=items.map(item=>({...item.record,id:item.id})),[true]),
}}));
import { runRefreshSlice } from '../../backend/refresh-scheduler';
beforeEach(()=>{state.rows=[];state.reject=false;});
const sources=Array.from({length:8},(_,i)=>({key:'source-'+i}));
it('continues small source slices across invocations instead of fetching the entire registry',async()=>{
  const calls:string[]=[];
  const run=async(source:{key:string})=>{calls.push(source.key);return {sourceKey:source.key,status:'SUCCESS'};};
  const first=await runRefreshSlice(sources,run);
  expect(first.states).toHaveLength(3);expect(calls).toEqual(['source-0','source-1','source-2']);
  await runRefreshSlice(sources,run);const last=await runRefreshSlice(sources,run);
  expect(calls).toEqual(sources.map(source=>source.key));expect(last.nextIndex).toBe(0);expect(last.cycleWrapped).toBe(true);
});
it('does not advance the schedule if a batch throws a quota error',async()=>{
  await expect(runRefreshSlice(sources,async()=>{throw new Error('AppDatabaseQuotaExceeded');})).rejects.toThrow('AppDatabaseQuotaExceeded');
  expect(state.rows).toHaveLength(0);
});
it('throws when the saved refresh checkpoint is not acknowledged',async()=>{
  state.reject=true;await expect(runRefreshSlice(sources,async(source)=>source)).rejects.toThrow('REFRESH_CHECKPOINT_SAVE_FAILED');
});
it('does no writes for an empty source registry',async()=>{
  const result=await runRefreshSlice([],async(source)=>source);
  expect(result.states).toEqual([]);expect(state.rows).toHaveLength(0);
});
