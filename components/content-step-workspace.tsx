"use client";
import {ContentScriptsWorkspace} from "./content-pipeline-workspaces";
import {ContentPackagingWorkspace} from "./content-packaging-workspace";
import {ContentShortformWorkspace} from "./content-shortform-workspace";
import {YoutubeKitWorkspace} from "./content-studio-workspaces";
import {useContentWork} from "./content-work-provider";
import {PageTitle} from "./page-title";
import {useSearchParams} from "next/navigation";
export function ContentStepWorkspace({step,showPlanningHandoff=false,showJevAssist=false}:{step:"scripts"|"packages"|"shorts"|"youtube";showPlanningHandoff?:boolean;showJevAssist?:boolean}) {
  const work=useContentWork();
  const search=useSearchParams(), requested=search.get("topic")??search.get("sourceId");
  const invalid=Boolean(work&&!work.loading&&requested&&requested!=="all"&&!work.selected);
  if(work?.loading||work?.error||invalid)return <><header className="page-header"><div className="page-title-group"><PageTitle/></div></header><section className="panel load-error" role="status">{work?.error||(invalid?"작업 중인 영상에서 접근 가능한 콘텐츠를 선택해 주세요.":"작업 영상 불러오는 중…")}{work?.error?<button onClick={work.reload}>다시 불러오기</button>:null}</section></>;
  const props={lockedSource:work?.selected,sourceOptions:work?.topics,onSourceChange:work?.select};
  return <div key={`${step}:${work?.topicId??""}`} className="content-step-workspace">
    {step==="scripts"?<ContentScriptsWorkspace showPlanningHandoff={showPlanningHandoff} lockedSource={work?.selected}/>:step==="packages"?<ContentPackagingWorkspace {...props} showJevAssist={showJevAssist}/>:step==="shorts"?<ContentShortformWorkspace {...props}/>:<YoutubeKitWorkspace {...props}/>}
  </div>;
}
