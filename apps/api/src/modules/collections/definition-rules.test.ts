import { describe, expect, it } from 'vitest';
import { displayedDefinition } from './definition-rules';
const dictionary=[{language:'zh',definition:'分析',senseIndex:0,reviewStatus:'approved'},{language:'en',definition:'To examine carefully.',senseIndex:0,reviewStatus:'approved'},{language:'fr',definition:'unreviewed text',senseIndex:0,reviewStatus:'pending'}];
describe('personal definition fallback',()=>{
  it('keeps a personal definition and its language ahead of all shared meanings',()=>{
    expect(displayedDefinition('分析一下问题','zh','en',dictionary,'An English meaning.')).toEqual({definition:'分析一下问题',language:'zh',definitionSource:'custom'});
  });
  it('uses reviewed preferred-language definitions, then English, then null',()=>{
    expect(displayedDefinition(null,null,'zh',dictionary,'fallback').definition).toBe('分析');
    expect(displayedDefinition(null,null,'fr',dictionary,'fallback').definition).toBe('To examine carefully.');
    expect(displayedDefinition('',null,'zh',[],'A live source definition.')).toMatchObject({definition:'A live source definition.',language:'en'});
    expect(displayedDefinition(null,null,'zh',[],null)).toEqual({definition:null,language:null,definitionSource:null});
  });
});
