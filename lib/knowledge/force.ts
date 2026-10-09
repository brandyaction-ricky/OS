import type {KnowledgeGraphNode,KnowledgeGraphEdge} from "../knowledge-links";
export interface Point {x:number;y:number;vx:number;vy:number;fixed?:boolean}
interface Quad {x:number;y:number;size:number;mass:number;cx:number;cy:number;points:Array<Point>;children?:Quad[]}
const CLUSTERS:Record<string,[number,number]>={mine:[-130,-80],team:[130,-80],canon:[0,130],meet:[-170,140],ai:[180,140]};
export function seedPositions(nodes:KnowledgeGraphNode[],previous:Map<string,Point>=new Map()){
  return new Map(nodes.map((n,i)=>{const prior=previous.get(n.id);if(prior)return [n.id,prior];const angle=i*2.399963229728653,radius=12*Math.sqrt(i+1),center=CLUSTERS[n.space??"team"];return [n.id,{x:center[0]+Math.cos(angle)*radius,y:center[1]+Math.sin(angle)*radius,vx:0,vy:0}];}));
}
function tree(points:Point[],x:number,y:number,size:number,depth=0):Quad{
  const q:Quad={x,y,size,mass:points.length,cx:0,cy:0,points};
  if(!points.length)return q;
  q.cx=points.reduce((sum,p)=>sum+p.x,0)/points.length;q.cy=points.reduce((sum,p)=>sum+p.y,0)/points.length;
  if(points.length>1&&depth<20&&size>.01){const half=size/2,groups:Point[][]=[[],[],[],[]];for(const p of points)groups[(p.x>=x+half?1:0)+(p.y>=y+half?2:0)].push(p);q.children=groups.map((g,i)=>tree(g,x+(i%2)*half,y+(i>1?half:0),half,depth+1));q.points=[];}
  return q;
}
export function forceStep(positions:Map<string,Point>,edges:KnowledgeGraphEdge[],{repulsion=4200,length=70,center=.02,alpha=.12}:{repulsion?:number;length?:number;center?:number;alpha?:number}={}){
  const points=[...positions.values()];if(!points.length)return;
  const minX=Math.min(...points.map(p=>p.x)),minY=Math.min(...points.map(p=>p.y)),span=Math.max(...points.map(p=>Math.max(p.x-minX,p.y-minY)))+1;
  const root=points.length>300?tree(points,minX,minY,span):null;
  function repel(p:Point,q:Quad){if(!q.mass)return;const dx=p.x-q.cx,dy=p.y-q.cy,d2=dx*dx+dy*dy+16;const contains=p.x>=q.x&&p.x<=q.x+q.size&&p.y>=q.y&&p.y<=q.y+q.size;
    if(q.children&&(contains||q.size/Math.sqrt(d2)>.7)){for(const child of q.children)repel(p,child);return;}
    if(!q.children){for(const other of q.points)if(other!==p){const x=p.x-other.x||.01,y=p.y-other.y||.01,den=x*x+y*y+16,f=Math.min(3,repulsion*alpha/den);p.vx+=x/Math.sqrt(den)*f;p.vy+=y/Math.sqrt(den)*f;}return;}
    const f=Math.min(12,repulsion*q.mass*alpha/d2);p.vx+=dx/Math.sqrt(d2)*f;p.vy+=dy/Math.sqrt(d2)*f;
  }
  if(root)for(const p of points)repel(p,root);
  else for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++){const a=points[i],b=points[j],dx=a.x-b.x||.01,dy=a.y-b.y||.01,d2=dx*dx+dy*dy+16,f=Math.min(3,repulsion*alpha/d2);a.vx+=dx/Math.sqrt(d2)*f;a.vy+=dy/Math.sqrt(d2)*f;b.vx-=dx/Math.sqrt(d2)*f;b.vy-=dy/Math.sqrt(d2)*f;}
  for(const edge of edges){const a=positions.get(edge.source),b=positions.get(edge.target);if(!a||!b)continue;const dx=b.x-a.x,dy=b.y-a.y,d=Math.sqrt(dx*dx+dy*dy)||1,f=(d-length)*.02*alpha;a.vx+=dx/d*f;a.vy+=dy/d*f;b.vx-=dx/d*f;b.vy-=dy/d*f;}
  for(const p of points){if(p.fixed){p.vx=0;p.vy=0;continue;}p.vx=(p.vx-p.x*center*alpha)*.85;p.vy=(p.vy-p.y*center*alpha)*.85;p.x+=Math.max(-12,Math.min(12,p.vx));p.y+=Math.max(-12,Math.min(12,p.vy));}
}
export function neighborIds(edges:KnowledgeGraphEdge[],id:string,depth:number){const ids=new Set([id]);let frontier=new Set([id]);for(let level=0;level<depth;level++){const next=new Set<string>();for(const e of edges){if(frontier.has(e.source))next.add(e.target);if(frontier.has(e.target))next.add(e.source);}next.forEach(id=>ids.add(id));frontier=next;}return ids;}
