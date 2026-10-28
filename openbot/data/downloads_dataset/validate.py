import json, sys, collections
D = sys.argv[1]
doms = ["email_triage","skill_selection","safety","routing"]
SK = ["weather","calendar","email","github","shell","computer","database","memory"]
ok = True
def bad(m):
    global ok; ok = False; print("FAIL:", m)
for d in doms:
    rows=[]
    for ln, line in enumerate(open(f"{D}/system1_{d}.jsonl", encoding="utf-8"),1):
        try: rows.append(json.loads(line))
        except Exception as e: bad(f"{d} line {ln} json {e}")
    sft=[json.loads(l) for l in open(f"{D}/sft_{d}.jsonl", encoding="utf-8")]
    if len(rows)!=1000 or len(sft)!=1000: bad(f"{d} count {len(rows)} {len(sft)}")
    ids=[r["id"] for r in rows]
    if len(set(ids))!=len(ids): bad(f"{d} dup ids")
    keyset=set(json.dumps(r["state"],sort_keys=True) for r in rows)
    if len(keyset)!=len(rows): bad(f"{d} duplicate states {len(rows)-len(keyset)}")
    for r,s in zip(rows,sft):
        if set(r)!={"id","domain","state","questions","answers"}: bad(f"{r['id']} keys")
        if set(r["questions"])!=set(r["answers"]): bad(f"{r['id']} qa keys")
        a=json.loads(s["messages"][2]["content"])
        if a!=r["answers"]: bad(f"{r['id']} sft mismatch")
        if [m["role"] for m in s["messages"]]!=["system","user","assistant"]: bad(f"{r['id']} roles")
        for k,v in r["answers"].items():
            if v["type"]=="noul" and not (0<=v["noul"]<=1): bad(f"{r['id']} noul range")
            if v["type"]=="choice":
                ch=list(r["questions"][k]["criteria"])
                if v["choice"] not in ch: bad(f"{r['id']} bad choice")
                if set(v["probabilities"])!=set(ch) or abs(sum(v["probabilities"].values())-1)>0.0015: bad(f"{r['id']} probs {v['probabilities']}")
                if max(v["probabilities"],key=v["probabilities"].get)!=v["choice"]: bad(f"{r['id']} argmax")
    if d=="email_triage":
        c=collections.Counter(r["answers"]["needs_you"]["noul"]>=0.5 for r in rows); print(d,"needs_you/can_wait",c)
    elif d=="skill_selection":
        c=collections.Counter()
        none=multi=0
        for r in rows:
            pos=[k for k,v in r["answers"].items() if v["noul"]>=0.5]
            if not pos: none+=1
            elif len(pos)>1: multi+=1
            else: c[pos[0]]+=1
        print(d,dict(c),"multi",multi,"none",none)
    else:
        key="verdict" if d=="safety" else "coworker"
        print(d,dict(collections.Counter(r["answers"][key]["choice"] for r in rows)))
for f in ["system1_all","sft_all"]:
    n=sum(1 for l in open(f"{D}/{f}.jsonl") if json.loads(l))
    print(f,n)
print("ALL OK" if ok else "FAILURES")
