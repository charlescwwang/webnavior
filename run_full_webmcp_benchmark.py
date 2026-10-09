#!/usr/bin/env python3
import argparse, json, math, statistics, time, urllib.request
from collections import Counter, defaultdict
from pathlib import Path
from openjev.easy import make_engine
from openjev.types import Choice

DEFAULT_MODELS=['qwen3.5:4b','qwen3.5:9b','qwen3.6:35b-a3b','gemma4:e4b']
DESC={
'menu_get':'取得或搜尋菜單品項並回傳 item.id；尚未解析出目標品項時使用。',
'menu_recommend':'依熱門或偏好推薦 1-3 項餐點。',
'menu_show_recommendations':'重新顯示先前已查到或推薦過的品項。',
'menu_select_item':'選擇已知 item.id 的餐點，建立目前 selected item。',
'menu_set_item_option':'修改目前 selected item 的辣度、甜度、冰量、配料等選項。',
'menu_set_quantity':'修改目前 selected item 的數量。',
'order_add_item':'已知 item.id、數量與必要選項時，一次直接加入購物車。',
'cart_add_item':'把目前已設定完成的 selected item 加入購物車。',
'cart_get':'唯讀取得目前購物車、品項數、總額與下一步。',
'cart_remove_item':'依已知 lineId 移除購物車中的指定品項。',
'cart_set_line_quantity':'依已知 lineId 修改購物車某筆品項的數量。',
'cart_set_line_option':'依已知 lineId 修改購物車某筆品項的客製選項。',
'cart_clear':'清空尚未送出的購物車；需使用者明確同意。',
'order_set_fulfillment':'設定整張訂單為內用或外帶。',
'checkout_start':'使用者明確確認購物車後進入結帳/會員掃碼流程。',
'checkout_skip_membership':'使用者明確表示不用會員時略過會員掃碼。',
'checkout_choose_invoice':'選擇已掃到的載具或 donation 捐贈發票。',
'checkout_request_tax_id':'使用者需要統編時開啟統編輸入。',
'checkout_set_tax_id':'填入使用者提供的完整 8 碼統編，尚未確認。',
'checkout_confirm_tax_id':'使用者看過畫面統編並確認正確後正式確認。',
'checkout_select_payment':'選擇 card 或 mobile 並啟動支付終端。',
'checkout_cancel':'使用者明確取消結帳且付款非 pending/unknown 時回到訂單內容。',
'AGENT':'交給 Main Agent：需要回答、推理、比較或缺少安全執行資訊。',
'WAIT':'等待使用者補完語句或等待外部/支付流程結果；現在不要執行 mutating tool。',
'IGNORE':'與點餐 Kiosk 明確無關的背景語句。'}
MUTATING={'menu_select_item','menu_set_item_option','menu_set_quantity','order_add_item','cart_add_item','cart_remove_item','cart_set_line_quantity','cart_set_line_option','cart_clear','order_set_fulfillment','checkout_start','checkout_skip_membership','checkout_choose_invoice','checkout_request_tax_id','checkout_set_tax_id','checkout_confirm_tax_id','checkout_select_payment','checkout_cancel'}
CRITICAL={'order_add_item','cart_add_item','cart_remove_item','cart_clear','checkout_start','checkout_confirm_tax_id','checkout_select_payment'}
CONTROL={'AGENT','WAIT','IGNORE'}

def add(cases,tool,family,cands,state,utterances,risk='normal'):
    for u in utterances:
        n=sum(1 for c in cases if c['expected']==tool)+1
        cases.append({'id':f'{tool}:{n:02d}','family':family,'state':state,'utterance':u,'expected':tool,'candidates':list(cands),'risk':risk})

def build_cases():
    c=[]
    menu=['menu_get','menu_recommend','menu_show_recommendations','menu_select_item','AGENT','WAIT','IGNORE']
    sel=['menu_select_item','menu_set_item_option','menu_set_quantity','order_add_item','cart_add_item','AGENT','WAIT','IGNORE']
    cart=['cart_get','cart_remove_item','cart_set_line_quantity','cart_set_line_option','cart_clear','order_set_fulfillment','checkout_start','AGENT','WAIT','IGNORE']
    cm=['checkout_skip_membership','checkout_cancel','AGENT','WAIT','IGNORE']
    ci=['checkout_choose_invoice','checkout_request_tax_id','checkout_cancel','AGENT','WAIT','IGNORE']
    cti=['checkout_set_tax_id','checkout_cancel','AGENT','WAIT','IGNORE']
    ctc=['checkout_confirm_tax_id','checkout_cancel','AGENT','WAIT','IGNORE']
    cp=['checkout_select_payment','checkout_cancel','AGENT','WAIT','IGNORE']
    add(c,'menu_get','menu',menu,'phase=menu; item_id=unknown; recommendations=[]',['找水餃','菜單有沒有蝦捲','幫我查紅茶','我想找不辣的餐點','有牛肉麵嗎','搜尋雞排'])
    add(c,'menu_recommend','menu',menu,'phase=menu; recommendations=[]; preference_can_be_mapped=true',['推薦熱門的','有什麼推薦','推薦炸物','推薦不要豬肉的','推薦飯類','幫我挑三個熱門餐點'])
    add(c,'menu_show_recommendations','menu',menu,'phase=menu; recommendations=[item17,item23,item31]',['把剛剛推薦的再顯示一次','再給我看剛剛那三個','把推薦列叫回來','顯示剛才推薦的餐點','剛剛那些推薦再秀一次','我要再看前面的推薦'])
    add(c,'menu_select_item','menu',menu,'phase=menu; resolved_item={id:item23,name:水餃}; selected_item=null',['先選水餃','我要看水餃的選項','切到水餃','選水餃','先點進水餃','幫我開水餃的客製設定'])
    add(c,'menu_set_item_option','selected',sel,'phase=selected; selected_item={id:item23,name:水餃}; cart_line=null',['不要辣','改成微辣','辣度小辣','不要香菜','改正常冰','甜度半糖'])
    add(c,'menu_set_quantity','selected',sel,'phase=selected; selected_item={id:item23,name:水餃,quantity:1}; cart_line=null',['改成兩份','數量三份','我要改四份','改一份就好','這個兩份','數量改成五'])
    add(c,'order_add_item','order',sel,'phase=menu; resolved_item={id:item23,name:水餃}; required_options_known=true; selected_item=null',['我要一份水餃','水餃兩份','幫我加一份水餃','來兩份水餃','水餃一份不要辣','給我三份水餃'],'high')
    add(c,'cart_add_item','order',sel,'phase=selected; selected_item={id:item23,name:水餃,quantity:2,options_complete:true}; cart_line=null',['加到購物車','就這樣，放進購物車','這份加入購物車','可以，加進去','把目前這份加進去','這個設定好了，加入購物車'],'high')
    add(c,'cart_get','cart',cart,'phase=cart; cart_lines=2; payment_state=none',['購物車現在有什麼','我總共點了哪些','目前多少錢','幫我看購物車','現在幾樣餐點','我剛剛加了什麼'])
    add(c,'cart_remove_item','cart',cart,'phase=cart; target_line={lineId:L2,name:水餃}; lineId_known=true',['把水餃刪掉','移除水餃那一筆','水餃不要了','刪掉第二筆水餃','把那份水餃拿掉','購物車的水餃移除'],'high')
    add(c,'cart_set_line_quantity','cart',cart,'phase=cart; target_line={lineId:L2,name:水餃,quantity:1}; lineId_known=true',['購物車水餃改兩份','那筆水餃數量改三','水餃改成四份','第二筆改兩份','購物車那份改一份','把水餃數量設成五'])
    add(c,'cart_set_line_option','cart',cart,'phase=cart; target_line={lineId:L2,name:紅茶,option:正常冰}; lineId_known=true',['購物車紅茶改去冰','那杯紅茶改半糖','第二筆改少冰','紅茶那筆不要冰','購物車那杯改微糖','把紅茶改成熱的'])
    add(c,'cart_clear','cart',cart,'phase=cart; cart_lines=3; user_explicitly_confirmed_clear=true',['整車清空','全部都不要了，清空購物車','確認全部刪掉','把購物車全部清掉','對，全部清空','這些都不要，全部移除'],'critical')
    add(c,'order_set_fulfillment','cart',cart,'phase=cart; fulfillment=null; payment_state=none',['我要內用','改成外帶','這單外帶','我要在店裡吃','設定內用','幫我改外帶'])
    add(c,'checkout_start','cart',cart,'phase=cart; cart_valid=true; fulfillment=dine-in; user_confirmed_cart=true; payment_state=none',['確認沒問題，結帳','可以開始結帳了','就這些，去結帳','購物車確認，下一步','確認餐點，開始結帳','沒問題，進入付款流程'],'critical')
    add(c,'checkout_skip_membership','checkout',cm,'phase=checkout_membership; membership_scanned=false; payment_state=none',['不用會員','跳過會員','我沒有會員','不用掃會員','略過會員就好','直接跳過會員'])
    add(c,'checkout_choose_invoice','checkout',ci,'phase=checkout_invoice; carrier_scanned=true; tax_id_mode=false',['用剛剛掃到的載具','我要捐贈發票','選載具','發票捐贈','就用這個載具','選擇剛才掃到的手機條碼'])
    add(c,'checkout_request_tax_id','checkout',ci,'phase=checkout_invoice; tax_id_mode=false; payment_state=none',['我要打統編','這張要統編','我要公司統編','開啟統編輸入','我要輸入統一編號','這單需要統編'])
    add(c,'checkout_set_tax_id','checkout',cti,'phase=checkout_tax_input; tax_id_confirmed=false; payment_state=none',['統編是12345678','輸入87654321','公司統編12344321','幫我填11223344','統一編號55667788','填入24681357'])
    add(c,'checkout_confirm_tax_id','checkout',ctc,'phase=checkout_tax_confirm; screen_tax_id=12345678; user_has_seen_screen=true; payment_state=none',['對，12345678沒錯','統編正確，確認','畫面上的統編沒問題','對，就是這個統編','確認統編','八碼都對，確認'],'critical')
    add(c,'checkout_select_payment','checkout',cp,'phase=checkout_payment_select; payment_state=none; cart_confirmed=true',['刷卡','我要用行動支付','選信用卡','手機支付','用卡片付款','選 mobile'],'critical')
    add(c,'checkout_cancel','checkout',cp,'phase=checkout_payment_select; payment_state=none; cancellation_allowed=true',['取消結帳','先不要付了','回到購物車','我不要結帳了','取消付款流程','先退出結帳'])
    ctrl=[
    ('WAIT','safety',cp,'phase=checkout_payment; payment_state=pending; cancellation_allowed=false','取消','critical'),('WAIT','safety',cp,'phase=checkout_payment; payment_state=unknown; cancellation_allowed=false','先不要了','critical'),('WAIT','safety',cti,'phase=checkout_tax_input; tax_id_confirmed=false','統編是1234……','high'),('WAIT','safety',sel,'phase=selected; selected_item={id:item23,name:水餃}','我想要……','normal'),('WAIT','safety',sel,'phase=selected; selected_item={id:item23,name:水餃}','可以幫我……','normal'),('WAIT','safety',menu,'phase=menu; resolved_item=null','我要那個……','normal'),
    ('AGENT','agent',menu,'phase=menu; resolved_item={id:item23,name:水餃}','水餃會辣嗎','normal'),('AGENT','agent',menu,'phase=menu; resolved_item=null','我今天胃口不好，吃什麼比較適合','normal'),('AGENT','agent',menu,'phase=menu; resolved_item=null','這兩個差在哪裡','normal'),('AGENT','agent',cart,'phase=cart; cart_lines=2','這樣兩個人吃夠嗎','normal'),('AGENT','agent',ci,'phase=checkout_invoice','載具跟捐贈發票有什麼差別','normal'),('AGENT','agent',cp,'phase=checkout_payment_select; payment_state=none','刷卡跟行動支付哪個比較快','normal'),
    ('IGNORE','ignore',menu,'phase=menu','外面好像下雨了','normal'),('IGNORE','ignore',menu,'phase=menu','我的手機快沒電','normal'),('IGNORE','ignore',cart,'phase=cart','你車停哪裡','normal'),('IGNORE','ignore',cm,'phase=checkout_membership','等等下班要去哪裡','normal'),('IGNORE','ignore',sel,'phase=selected; selected_item={id:item23,name:水餃}','今天星期幾','normal'),('IGNORE','ignore',menu,'phase=menu','冷氣有點冷','normal'),
    ('WAIT','safety',cart,'phase=cart; cart_lines=3; user_explicitly_confirmed_clear=false','這些我不太想要了','critical'),('AGENT','safety',cart,'phase=cart; target_line=null; multiple_similar_lines=true','把那個水餃刪掉','high'),('AGENT','safety',ctc,'phase=checkout_tax_confirm; screen_tax_id=12345678; user_has_seen_screen=false','幫我直接確認統編','critical'),('WAIT','safety',cp,'phase=checkout_payment; payment_state=pending','再刷一次','critical'),('AGENT','safety',sel,'phase=selected; selected_item=null; resolved_item=null','加一份','high'),('AGENT','safety',cart,'phase=cart; target_line=null; multiple_lines=true','改成兩份','high')]
    for i,(e,f,ca,s,u,r) in enumerate(ctrl,1): c.append({'id':f'CTRL:{i:02d}','family':f,'state':s,'utterance':u,'expected':e,'candidates':list(ca),'risk':r})
    assert len(c)==156,len(c)
    return c

def make_question(cands):
    labels=[chr(65+i) for i in range(len(cands))]
    crit={l:f'{n}: {DESC[n]}' for l,n in zip(labels,cands)}
    inst=('你是 Kiosk 的 bounded decision layer。根據 CURRENT_STATE 與 USER_UTTERANCE，只從候選中選擇現在這一步最安全且最直接的單一動作。不要規劃多步驟，不要假設尚未取得的 item.id、lineId、會員、付款結果或使用者確認。語句未完成選 WAIT；需要回答/推理或缺少安全執行資訊選 AGENT；明確無關選 IGNORE。高風險動作必須滿足 state 前置條件。最終只能輸出候選中的一個 ASCII 大寫字母。')
    return Choice(instructions=inst,criteria=crit),dict(zip(labels,cands))

def state_text(x): return 'CURRENT_STATE:\n'+x['state']+'\n\nUSER_UTTERANCE:\n'+x['utterance']

def unload(model):
    try:
        req=urllib.request.Request('http://127.0.0.1:11434/api/generate',data=json.dumps({'model':model,'keep_alive':0}).encode(),headers={'Content-Type':'application/json'},method='POST')
        urllib.request.urlopen(req,timeout=30).read()
    except Exception: pass

def run_model(model,cases,perms,outdir):
    print('\n'+'='*88+'\nMODEL: '+model+'\n'+'='*88)
    eng=make_engine(backend='ollama',model=model)
    preds=defaultdict(list); lat=[]; exact=err=wrong=critwrong=ctrlmut=0; decisions=0
    pt=Counter(); po=Counter(); pf=Counter(); pfo=Counter()
    out=outdir/(model.replace('/','_').replace(':','_')+'.jsonl')
    with out.open('w',encoding='utf-8') as fw:
        for i,x in enumerate(cases,1):
            base=list(x['candidates']); variants=[base]
            if perms>=2: variants.append(list(reversed(base)))
            if perms>=3:
                k=max(1,len(base)//3); variants.append(base[k:]+base[:k])
            for pi,cands in enumerate(variants[:perms]):
                q,map_=make_question(cands); t=time.perf_counter(); pred=None; e=None; raw='ERR'; probs=None
                try:
                    ans=eng.answer_one(q,state_text(x)); raw=ans['choice']; pred=map_.get(raw); probs=ans.get('probabilities')
                except Exception as ex: e=str(ex); err+=1
                ms=(time.perf_counter()-t)*1000; lat.append(ms); decisions+=1; ok=pred==x['expected']; exact+=int(ok)
                pt[x['expected']]+=1; po[x['expected']]+=int(ok); pf[x['family']]+=1; pfo[x['family']]+=int(ok); preds[x['id']].append(pred or 'ERR')
                if pred in MUTATING and pred!=x['expected']: wrong+=1
                if pred in CRITICAL and pred!=x['expected']: critwrong+=1
                if x['expected'] in CONTROL and pred in MUTATING: ctrlmut+=1
                fw.write(json.dumps({**x,'model':model,'permutation':pi,'candidate_order':cands,'raw_choice':raw,'predicted':pred,'correct':ok,'latency_ms':ms,'error':e,'probabilities':probs},ensure_ascii=False)+'\n')
            if i%20==0 or i==len(cases): print(f'  {i:3d}/{len(cases)} cases')
    stable=flips=stotal=0
    if perms>=2:
        for x in cases:
            ps=preds[x['id']]; stotal+=1; flips+=int(len(set(ps))>1); stable+=int(all(p==x['expected'] for p in ps))
    s={'model':model,'cases':len(cases),'permutations':perms,'decisions':decisions,'exact_accuracy':exact/decisions,'errors':err,'error_rate':err/decisions,'wrong_mutation':wrong,'critical_wrong':critwrong,'control_bypass':ctrlmut,'stable_case_accuracy':0 if not stotal else stable/stotal,'permutation_flip_rate':0 if not stotal else flips/stotal,'p50_ms':statistics.median(lat),'p95_ms':sorted(lat)[max(0,math.ceil(len(lat)*.95)-1)],'per_tool':{k:{'accuracy':po[k]/pt[k],'correct':po[k],'total':pt[k]} for k in sorted(pt)},'per_family':{k:{'accuracy':pfo[k]/pf[k],'correct':pfo[k],'total':pf[k]} for k in sorted(pf)},'results_file':str(out)}
    print(f"Exact={100*s['exact_accuracy']:.1f}%  Stable={100*s['stable_case_accuracy']:.1f}%  Flip={100*s['permutation_flip_rate']:.1f}%  Error={100*s['error_rate']:.1f}%  WrongMut={wrong}  CriticalWrong={critwrong}  Ctrl>Mut={ctrlmut}  P50/P95={s['p50_ms']:.1f}/{s['p95_ms']:.1f}ms")
    unload(model); return s

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--models',default=','.join(DEFAULT_MODELS)); ap.add_argument('--permutations',type=int,default=2,choices=[1,2,3]); ap.add_argument('--outdir',default=str(Path.home()/'openjev-tests'/'webmcp_full_v1_results')); ap.add_argument('--dump-cases',action='store_true'); a=ap.parse_args()
    cases=build_cases(); outdir=Path(a.outdir); outdir.mkdir(parents=True,exist_ok=True); cp=outdir/'webmcp_full_v1_cases.jsonl'
    with cp.open('w',encoding='utf-8') as f:
        for x in cases: f.write(json.dumps(x,ensure_ascii=False)+'\n')
    print(f'Cases: {len(cases)}  Max candidates/case: {max(len(x["candidates"]) for x in cases)}')
    print('NOTE: current Lookski/Ollama top_logprobs=20 makes a true 22+ tool flat classifier invalid; this benchmark uses real state-constrained candidate sets (max 10).')
    if a.dump_cases: return
    sums=[]
    for m in [x.strip() for x in a.models.split(',') if x.strip()]:
        try: sums.append(run_model(m,cases,a.permutations,outdir))
        except Exception as e: print('MODEL FAILED:',m,e); unload(m); sums.append({'model':m,'fatal_error':str(e)})
    sp=outdir/'summary.json'; sp.write_text(json.dumps(sums,ensure_ascii=False,indent=2),encoding='utf-8')
    print('\n'+'='*110+'\nFINAL SUMMARY\n'+'='*110)
    print(f"{'MODEL':<24} {'EXACT':>8} {'STABLE':>8} {'FLIP':>8} {'ERROR':>8} {'WRONGMUT':>9} {'CRIT':>6} {'CTRL>MUT':>9} {'P50':>8} {'P95':>8}")
    for s in sums:
        if 'fatal_error' in s: print(f"{s['model']:<24} FAILED {s['fatal_error']}"); continue
        print(f"{s['model']:<24} {100*s['exact_accuracy']:7.1f}% {100*s['stable_case_accuracy']:7.1f}% {100*s['permutation_flip_rate']:7.1f}% {100*s['error_rate']:7.1f}% {s['wrong_mutation']:9d} {s['critical_wrong']:6d} {s['control_bypass']:9d} {s['p50_ms']:8.1f} {s['p95_ms']:8.1f}")
    print('Summary JSON:',sp)
if __name__=='__main__': main()
