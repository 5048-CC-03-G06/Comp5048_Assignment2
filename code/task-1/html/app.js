(() => {
  const DATA = window.TASK1_DATA;
  if (!DATA) throw new Error("Task 1 data is missing. Run build_task1_data.py first.");

  const fields = DATA.fields;
  const byKey = Object.fromEntries(fields.map((field, index) => [field.key, {...field, index}]));
  const records = DATA.records.map((row, id) => ({
    id, time: row[0], date: row[1], hour: row[2], month: row[3], season: row[4], values: row.slice(5),
  }));
  const state = { start: DATA.range.start, end: DATA.range.end, season: "All", month: 0, hourFrom: 0, hourTo: 23, selectedIds: new Set(), selectedDates: new Set(), x: "co_gt", y: "c6h6_gt" };
  const $ = (id) => document.getElementById(id);
  const median = (values) => { const v = values.filter(Number.isFinite).sort((a,b)=>a-b); if (!v.length) return null; const m=Math.floor(v.length/2); return v.length%2 ? v[m] : (v[m-1]+v[m])/2; };
  const format = (value, digits = 2) => value == null ? "—" : Number(value).toLocaleString(undefined,{maximumFractionDigits:digits});
  const fieldValue = (record, key) => record.values[byKey[key].index];
  // Tableau-aligned encodings: a diverging blue-to-red heatmap and season
  // colours for the CO–C6H6 relationship plot.
  const clamp = (value) => Math.max(0, Math.min(1, value));
  const blend = (a, b, amount) => a.map((v, i) => Math.round(v + (b[i] - v) * amount));
  const heatColour = (scaled) => {
    const t = clamp(scaled);
    const rgb = t < .5
      ? blend([43, 108, 176], [238, 242, 247], t * 2)
      : blend([238, 242, 247], [214, 59, 59], (t - .5) * 2);
    return `rgb(${rgb.join(",")})`;
  };
  const seasonColour = {
    Autumn: "rgba(78, 121, 167, .58)",
    Spring: "rgba(242, 142, 43, .58)",
    Summer: "rgba(225, 87, 89, .58)",
    Winter: "rgba(118, 183, 178, .58)",
  };

  function filtered() {
    return records.filter(r => r.date >= state.start && r.date <= state.end && (state.season === "All" || r.season === state.season) && (!state.month || r.month === state.month) && r.hour >= state.hourFrom && r.hour <= state.hourTo);
  }
  function selected(current) {
    if (state.selectedIds.size) return current.filter(r => state.selectedIds.has(r.id));
    if (state.selectedDates.size) return current.filter(r => state.selectedDates.has(r.date));
    return [];
  }
  function resize(canvas) {
    const rect = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr);
    const ctx = canvas.getContext("2d"); ctx.setTransform(dpr,0,0,dpr,0,0); return {ctx, w:rect.width, h:rect.height};
  }
  function clearSelection() { state.selectedIds.clear(); state.selectedDates.clear(); render(); }
  function updateStatus(current, chosen) {
    $("visibleCount").textContent = `Visible core records: ${current.length.toLocaleString()}`;
    $("selectedCount").textContent = chosen.length ? `Selected records: ${chosen.length.toLocaleString()}` : "No candidate group selected";
    const threshold = Math.ceil((state.hourTo - state.hourFrom + 1) * .75);
    $("coverageInfo").textContent = `Daily heatmap coverage threshold: ${threshold} valid hour(s)`;
  }
  function renderHeatmap(current) {
    const svg = $("heatmap"), byDate = new Map();
    current.forEach(r => { if (!byDate.has(r.date)) byDate.set(r.date, []); byDate.get(r.date).push(r); });
    const threshold = Math.ceil((state.hourTo - state.hourFrom + 1) * .75);
    const days = [...byDate.entries()].filter(([, rows]) => rows.length >= threshold).sort((a,b)=>a[0].localeCompare(b[0]));
    const left=94, top=28, col=72, row=18, width=left+fields.length*col+8, height=top+Math.max(days.length,1)*row+6;
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`); svg.setAttribute("width", width); svg.setAttribute("height", height); svg.replaceChildren();
    fields.forEach((field, i) => { const label=document.createElementNS("http://www.w3.org/2000/svg","text"); label.setAttribute("x", left+i*col+col/2); label.setAttribute("y", 19); label.setAttribute("text-anchor","middle"); label.setAttribute("font-size","10"); label.setAttribute("fill","#486581"); label.textContent=field.label.replace("PT08.","P08."); svg.append(label); });
    days.forEach(([date, rows], ri) => {
      const label=document.createElementNS("http://www.w3.org/2000/svg","text"); label.setAttribute("x", left-7); label.setAttribute("y", top+ri*row+13); label.setAttribute("text-anchor","end"); label.setAttribute("font-size","10"); label.setAttribute("fill", state.selectedDates.has(date) ? "#1677c8" : "#486581"); label.textContent=date; svg.append(label);
      fields.forEach((field, fi) => {
        const value=median(rows.map(r=>r.values[fi])), [min,max]=DATA.ranges[field.key], scaled=clamp((value-min)/(max-min));
        // Tableau's heatmap uses scaled median for both colour and mark size.
        const width=10+scaled*(col-6), x=left+fi*col+(col-width)/2;
        const cell=document.createElementNS("http://www.w3.org/2000/svg","rect"); cell.setAttribute("x",x); cell.setAttribute("y",top+ri*row); cell.setAttribute("width",width); cell.setAttribute("height",row-2); cell.setAttribute("rx",1); cell.setAttribute("fill",heatColour(scaled)); cell.setAttribute("stroke",state.selectedDates.has(date)?"#102a43":"none"); cell.setAttribute("stroke-width","2");
        const title=document.createElementNS("http://www.w3.org/2000/svg","title"); title.textContent=`${date}\n${field.label}: ${format(value)} ${field.unit}\nValid selected hours: ${rows.length}`; cell.append(title);
        cell.addEventListener("click", () => { state.selectedIds.clear(); state.selectedDates.has(date) ? state.selectedDates.delete(date) : state.selectedDates.add(date); render(); }); svg.append(cell);
      });
    });
  }
  let scatterTransform = null, scatterPoints = [];
  function renderScatter(current, chosen) {
    const canvas=$("scatter"), {ctx,w,h}=resize(canvas), m={l:52,r:18,t:18,b:38}; ctx.clearRect(0,0,w,h); const x=byKey[state.x], y=byKey[state.y], [xmin,xmax]=DATA.ranges[x.key], [ymin,ymax]=DATA.ranges[y.key];
    const sx=v=>m.l+(v-xmin)/(xmax-xmin)*(w-m.l-m.r), sy=v=>h-m.b-(v-ymin)/(ymax-ymin)*(h-m.t-m.b); scatterTransform={sx,sy,xmin,xmax,ymin,ymax,m,w,h};
    ctx.strokeStyle="#bcccdc";ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(m.l,m.t);ctx.lineTo(m.l,h-m.b);ctx.lineTo(w-m.r,h-m.b);ctx.stroke();ctx.fillStyle="#486581";ctx.font="12px Arial";ctx.fillText(x.label,m.l,h-12);ctx.save();ctx.translate(14,h/2);ctx.rotate(-Math.PI/2);ctx.fillText(y.label,0,0);ctx.restore();
    const chosenIds=new Set(chosen.map(r=>r.id)); scatterPoints=[]; current.forEach(r=>{const px=sx(fieldValue(r,x.key)),py=sy(fieldValue(r,y.key)); scatterPoints.push({r,px,py});ctx.fillStyle=chosenIds.has(r.id)?"rgba(18, 52, 86, .95)":seasonColour[r.season];ctx.fillRect(px-2,py-2,4,4);});
  }
  function renderParallel(current, chosen) {
    const canvas=$("parallel"), {ctx,w,h}=resize(canvas), m={l:42,r:18,t:28,b:30}, step=(w-m.l-m.r)/(fields.length-1), y=v=>h-m.b-v*(h-m.t-m.b);ctx.clearRect(0,0,w,h);fields.forEach((field,i)=>{const x=m.l+i*step;ctx.strokeStyle="#bcccdc";ctx.beginPath();ctx.moveTo(x,m.t);ctx.lineTo(x,h-m.b);ctx.stroke();ctx.save();ctx.translate(x,18);ctx.rotate(-Math.PI/5);ctx.textAlign="right";ctx.fillStyle="#486581";ctx.font="11px Arial";ctx.fillText(field.label,0,0);ctx.restore();}); const chosenIds=new Set(chosen.map(r=>r.id));
    const draw=(r,stroke,width)=>{ctx.strokeStyle=stroke;ctx.lineWidth=width;ctx.beginPath();fields.forEach((field,i)=>{const [min,max]=DATA.ranges[field.key], px=m.l+i*step,py=y((r.values[i]-min)/(max-min));i?ctx.lineTo(px,py):ctx.moveTo(px,py);});ctx.stroke();}; current.forEach(r=>draw(r,chosenIds.has(r.id)?"rgba(20,20,20,.78)":"rgba(20,20,20,.045)",chosenIds.has(r.id)?1.2:.6));
  }
  function render() { const current=filtered(), chosen=selected(current); updateStatus(current,chosen);renderHeatmap(current);renderScatter(current,chosen);renderParallel(current,chosen); }
  function setOptions() { const months=["January","February","March","April","May","June","July","August","September","October","November","December"];months.forEach((label,i)=>$("month").insertAdjacentHTML("beforeend",`<option value="${i+1}">${label}</option>`));for(let h=0;h<24;h++){ $("hourFrom").insertAdjacentHTML("beforeend",`<option value="${h}">${String(h).padStart(2,"0")}:00</option>`); $("hourTo").insertAdjacentHTML("beforeend",`<option value="${h}">${String(h).padStart(2,"0")}:00</option>`);} $("hourTo").value="23";fields.forEach(field=>{ $("xField").insertAdjacentHTML("beforeend",`<option value="${field.key}">${field.label}</option>`); $("yField").insertAdjacentHTML("beforeend",`<option value="${field.key}">${field.label}</option>`);});$("xField").value=state.x;$("yField").value=state.y;$("startDate").min=$("endDate").min=DATA.range.start;$("startDate").max=$("endDate").max=DATA.range.end;$("startDate").value=state.start;$("endDate").value=state.end;$("cohortNote").textContent=`Core analysis cohort: ${DATA.coreRows.toLocaleString()} complete hourly records (${Math.round(DATA.coreRows/DATA.sourceRows*100)}% of ${DATA.sourceRows.toLocaleString()}).`; }
  function bindControls() { const sync=()=>{state.start=$("startDate").value;state.end=$("endDate").value;state.season=$("season").value;state.month=+$("month").value;state.hourFrom=+$("hourFrom").value;state.hourTo=+$("hourTo").value;if(state.hourFrom>state.hourTo)state.hourTo=state.hourFrom;state.selectedIds.clear();state.selectedDates.clear();render();};["startDate","endDate","season","month","hourFrom","hourTo"].forEach(id=>$(id).addEventListener("change",sync));$("xField").addEventListener("change",e=>{state.x=e.target.value;render();});$("yField").addEventListener("change",e=>{state.y=e.target.value;render();});$("clearSelection").addEventListener("click",clearSelection);$("resetFilters").addEventListener("click",()=>{state.start=DATA.range.start;state.end=DATA.range.end;state.season="All";state.month=0;state.hourFrom=0;state.hourTo=23;$("startDate").value=state.start;$("endDate").value=state.end;$("season").value="All";$("month").value="0";$("hourFrom").value="0";$("hourTo").value="23";clearSelection();}); }
  function bindScatterBrush() { const canvas=$("scatter"), tooltip=$("tooltip");let origin=null;canvas.addEventListener("pointerdown",e=>{const r=canvas.getBoundingClientRect();origin={x:e.clientX-r.left,y:e.clientY-r.top};canvas.setPointerCapture(e.pointerId);});canvas.addEventListener("pointerup",e=>{if(!origin||!scatterTransform)return;const r=canvas.getBoundingClientRect(),end={x:e.clientX-r.left,y:e.clientY-r.top},dx=Math.abs(end.x-origin.x),dy=Math.abs(end.y-origin.y);if(dx>6&&dy>6){const loX=Math.min(origin.x,end.x),hiX=Math.max(origin.x,end.x),loY=Math.min(origin.y,end.y),hiY=Math.max(origin.y,end.y);state.selectedDates.clear();state.selectedIds=new Set(scatterPoints.filter(p=>p.px>=loX&&p.px<=hiX&&p.py>=loY&&p.py<=hiY).map(p=>p.r.id));render();}origin=null;});canvas.addEventListener("mousemove",e=>{const r=canvas.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;let nearest=null,best=64;scatterPoints.forEach(p=>{const d=(p.px-x)**2+(p.py-y)**2;if(d<best){best=d;nearest=p;}});if(!nearest){tooltip.hidden=true;return;}const rec=nearest.r;tooltip.hidden=false;tooltip.style.left=`${Math.min(x+12,r.width-230)}px`;tooltip.style.top=`${Math.max(4,y-56)}px`;tooltip.textContent=`${rec.date} ${String(rec.hour).padStart(2,"0")}:00\n${byKey[state.x].label}: ${format(fieldValue(rec,state.x))} ${byKey[state.x].unit}\n${byKey[state.y].label}: ${format(fieldValue(rec,state.y))} ${byKey[state.y].unit}`;});canvas.addEventListener("mouseleave",()=>tooltip.hidden=true); }
  setOptions(); bindControls(); bindScatterBrush(); window.addEventListener("resize",render); render();
})();
