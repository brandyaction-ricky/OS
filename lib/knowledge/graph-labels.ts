export interface LabelBox {id:string;x:number;y:number;width:number;height:number;priority:number;required?:boolean}

/** Screen-space culling, shared by SVG and canvas; high-priority labels win. */
export function visibleGraphLabels(boxes:LabelBox[]):Set<string>{
  const buckets=new Map<string,LabelBox[]>(),visible=new Set<string>();
  for(const box of [...boxes].sort((a,b)=>Number(Boolean(b.required))-Number(Boolean(a.required))||b.priority-a.priority||a.id.localeCompare(b.id))){
    const cells:string[]=[];
    for(let x=Math.floor(box.x/64);x<=Math.floor((box.x+box.width)/64);x++)for(let y=Math.floor(box.y/32);y<=Math.floor((box.y+box.height)/32);y++)cells.push(`${x}:${y}`);
    const collision=cells.some(key=>(buckets.get(key)??[]).some(other=>box.x<other.x+other.width&&box.x+box.width>other.x&&box.y<other.y+other.height&&box.y+box.height>other.y));
    if(collision&&!box.required)continue;
    visible.add(box.id);for(const key of cells){const entries=buckets.get(key)??[];entries.push(box);buckets.set(key,entries);}
  }
  return visible;
}
