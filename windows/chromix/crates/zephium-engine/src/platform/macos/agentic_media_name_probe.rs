//! Probe-only exact-source cache. Private frame provenance is never logged;
//! no page content, DOM, field values, geometry, or pixels are retained here.
use sha2::{Digest, Sha256};
use std::collections::VecDeque;
use std::io::Write;
use std::sync::{Arc, Mutex, OnceLock};
use zephium_agentic::{SemanticFrameJoin, SemanticMediaNameProbe, SemanticSnapshot};
const MAX_SNAPSHOTS: usize = 64;
const MAX_ROWS: usize = 32;
#[derive(Clone, Eq, PartialEq)]
struct Row {
    key: u64,
    flags: u32,
    ancestors: Vec<u32>,
}
pub(crate) struct NameRows(Vec<Row>);
struct Entry<F> {
    frame: F,
    invocation: u64,
    generation: u64,
    digest: [u8; 32],
    rows: Vec<Row>,
    ambiguous: bool,
}
struct Cache<F>(VecDeque<Entry<F>>);
impl<F: Clone + Eq> Cache<F> {
    fn insert(
        &mut self,
        frame: &F,
        invocation: u64,
        generation: u64,
        digest: [u8; 32],
        rows: Vec<Row>,
    ) {
        if let Some(entry) = self
            .0
            .iter_mut()
            .find(|e| &e.frame == frame && e.invocation == invocation && e.generation == generation)
        {
            if entry.digest != digest || entry.rows != rows {
                entry.ambiguous = true;
                entry.rows.clear();
            }
            return;
        }
        if self.0.len() == MAX_SNAPSHOTS {
            self.0.pop_front();
        }
        self.0.push_back(Entry {
            frame: frame.clone(),
            invocation,
            generation,
            digest,
            rows,
            ambiguous: false,
        });
    }
    fn lookup(&self, frame: &F, invocation: u64, generation: u64, key: u64) -> Option<Row> {
        let entry = self.0.iter().find(|e| {
            &e.frame == frame && e.invocation == invocation && e.generation == generation
        })?;
        if entry.ambiguous {
            return None;
        }
        entry.rows.iter().find(|row| row.key == key).cloned()
    }
}
fn cache() -> &'static Mutex<Cache<SemanticFrameJoin>> {
    static CACHE: OnceLock<Mutex<Cache<SemanticFrameJoin>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(Cache(VecDeque::new())))
}
pub(super) fn configure(active: bool) {
    if let Ok(mut cache) = cache().lock() {
        cache.0.clear();
    }
    zephium_agentic::set_semantic_media_name_probe(
        active.then(|| Arc::new(report) as Arc<zephium_agentic::SemanticMediaNameObserver>),
    );
}
pub(super) fn split(bytes: &[u8]) -> Option<(NameRows, &[u8])> {
    let rest = bytes.strip_prefix(b"MN1:")?;
    let end = rest.iter().take(4096).position(|b| *b == b'\n')?;
    let values: serde_json::Value = serde_json::from_slice(&rest[..end]).ok()?;
    let values = values.as_array()?;
    if values.len() > MAX_ROWS {
        return None;
    }
    let mut rows = Vec::new();
    for value in values {
        let row = value.as_array()?;
        if row.len() != 3 {
            return None;
        }
        let key = row[0].as_u64()?;
        let flags = u32::try_from(row[1].as_u64()?).ok()?;
        if key == 0
            || key > 9_007_199_254_740_991
            || rows.iter().any(|r: &Row| r.key == key)
            || !valid_flags(flags)
        {
            return None;
        }
        let raw = row[2].as_array()?;
        if raw.len() > 8 {
            return None;
        }
        let mut ancestors = Vec::new();
        for value in raw {
            let value = u32::try_from(value.as_u64()?).ok()?;
            if !valid_ancestor(value) {
                return None;
            }
            ancestors.push(value);
        }
        rows.push(Row {
            key,
            flags,
            ancestors,
        });
    }
    let body = &rest[end + 1..];
    body.starts_with(b"MD1:").then_some((NameRows(rows), body))
}
fn valid_flags(value: u32) -> bool {
    value < (1 << 29)
        && ((value >> 20) & 31) <= 26
        && (((value >> 25) & 15) <= 8 || ((value >> 25) & 15) == 15)
        && value & 15 <= 8
        && ((value >> 8) & 15) <= 10
        && ((value >> 16) & 15) <= 13
        && [0, 1, 2, 3, 4, 5, 6, 7, 8, 15].contains(&((value >> 4) & 15))
        && [0, 1, 2, 3, 4, 5, 6, 7, 8, 15].contains(&((value >> 12) & 15))
}
fn valid_ancestor(value: u32) -> bool {
    let images = (value >> 3) & 63;
    let geometry = (value >> 13) & 63;
    value < (1 << 30)
        && ((value >> 21) & 31) <= 26
        && (((value >> 26) & 15) <= 8 || ((value >> 26) & 15) == 15)
        && (images <= 48 || images == 63)
        && (geometry <= 48 || geometry == 63)
        && ((value >> 19) & 3) <= 2
}
pub(super) fn remember(snapshot: &SemanticSnapshot, rows: NameRows, body: &[u8]) {
    if !super::enabled() {
        return;
    }
    let digest: [u8; 32] = Sha256::digest(body).into();
    if let Ok(mut cache) = cache().lock() {
        if super::enabled() {
            cache.insert(
                snapshot.frame(),
                snapshot.invocation().get(),
                snapshot.generation().get(),
                digest,
                rows.0,
            );
        }
    }
}
fn report(sources: &[SemanticMediaNameProbe], incomplete: bool) {
    if !super::enabled() {
        return;
    }
    let mut seen: Vec<&SemanticMediaNameProbe> = Vec::new();
    for source in sources.iter().take(128) {
        let reused = seen.iter().any(|old| {
            old.frame() == source.frame()
                && old.invocation() == source.invocation()
                && old.snapshot() == source.snapshot()
                && old.node() == source.node()
        });
        seen.push(source);
        let row = cache().lock().ok().and_then(|cache| {
            cache.lookup(
                source.frame(),
                source.invocation(),
                source.snapshot(),
                source.node(),
            )
        });
        if !super::enabled() {
            return;
        }
        if let Some(row) = row {
            let first = [
                "Unknown",
                "Related",
                "RootBoundary",
                "MultipleHeadings",
                "CardBoundary",
                "Geometry",
                "Depth",
                "Work",
                "NoCandidates",
            ][(row.flags & 15) as usize];
            let inherit = [
                "NotTried",
                "Inherited",
                "AlreadyRelated",
                "WrongRole",
                "Boundary",
                "UnprovedLink",
                "Geometry",
                "ReferenceCap",
                "PeerVisual",
                "Depth",
                "Work",
            ][((row.flags >> 8) & 15) as usize];
            let link = [
                "Unknown",
                "Ready",
                "NoDestination",
                "OwnedCount",
                "OwnedIndex",
                "AdmittedCount",
                "ExtraVisual",
                "Shadow",
                "Foreign",
                "Opaque",
                "NodeOrStackLimit",
                "PseudoVisual",
                "ExpectedMissing",
                "WorkLimit",
            ][((row.flags >> 16) & 15) as usize];
            let aria = aria_reason((row.flags >> 20) & 31);
            let aria_depth = (row.flags >> 25) & 15;
            let ancestors: Vec<_> = row
                .ancestors
                .iter()
                .map(|v| {
                    (
                        v & 7,
                        (v >> 3) & 63,
                        (v >> 9) & 3,
                        (v >> 11) & 3,
                        (v >> 13) & 63,
                        (v >> 19) & 3,
                        (v >> 21) & 31,
                        (v >> 26) & 15,
                        label_reason((v >> 21) & 31),
                    )
                })
                .collect();
            let _ = writeln!(std::io::stderr().lock(),"record-media-name: record={} reused={} first={first} first_depth={} inheritance={inherit} inheritance_depth={} link={link} aria={aria} aria_depth={aria_depth} ancestors={ancestors:?} incomplete={incomplete} content=redacted",source.record(),reused,(row.flags>>4)&15,(row.flags>>12)&15);
        } else {
            let _ = writeln!(std::io::stderr().lock(),"record-media-name: record={} reused={} unavailable=true incomplete={incomplete} content=redacted",source.record(),reused);
        }
    }
}
fn aria_reason(value: u32) -> &'static str {
    match value {
        0 => "NotTried",
        1 => "NativeNameIdentity",
        2 => "InlineName",
        3 => "UniqueDocumentId",
        4 => "RootBoundary",
        5 => "LocalSubtree",
        6 => "UniqueVisualAndLink",
        7 => "ExactLabelAndCover",
        8 => "CapturedVisualAndLink",
        9 => "StackedGeometry",
        10 => "ContentAncestry",
        11 => "PhotoBranch",
        12 => "FirstTextName",
        13 => "PeerBound",
        14 => "RepeatedPeer",
        15 => "Proved",
        16 => "AncestorWork",
        17 => "Exception",
        18 => "DepthOrMissing",
        19 => "TotalWorkBound",
        20 => "NodeOrStackBound",
        21 => "InteractiveDescendant",
        22 => "OpaqueOrForeignDescendant",
        23 => "NestedRecord",
        24 => "PseudoVisual",
        25 => "TextNodeBound",
        26 => "EditableDescendant",
        _ => "Unknown",
    }
}
fn label_reason(value: u32) -> &'static str {
    match value {
        0..=15 => "Relation",
        16 => "NoUniqueCapturedLink",
        17 => "AttributeBound",
        18 => "ReferenceCountBound",
        19 => "MissingTarget",
        20 => "RepeatedReference",
        21 => "AncestryBound",
        22 => "TotalWorkBound",
        23 => "LabelNodeBound",
        24 => "Exception",
        25 => "DuplicateTarget",
        26 => "UnknownTreeScope",
        _ => "Invalid",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn row(key: u64) -> Row {
        Row {
            key,
            flags: 0,
            ancestors: vec![],
        }
    }
    #[test]
    fn exact_frame_and_capture_are_required_and_conflicting_reuse_never_heals() {
        let mut cache = Cache(VecDeque::new());
        let a = (1u64, 2u64, 3u64, 4u64);
        let b = (1, 2, 3, 5);
        cache.insert(&a, 7, 9, [1; 32], vec![row(4)]);
        assert!(cache.lookup(&a, 7, 9, 4).is_some());
        for (frame, i, g, k) in [(b, 7, 9, 4), (a, 8, 9, 4), (a, 7, 10, 4), (a, 7, 9, 5)] {
            assert!(cache.lookup(&frame, i, g, k).is_none());
        }
        cache.insert(&a, 7, 9, [2; 32], vec![row(4)]);
        assert!(cache.lookup(&a, 7, 9, 4).is_none());
        cache.insert(&a, 7, 9, [1; 32], vec![row(4)]);
        assert!(cache.lookup(&a, 7, 9, 4).is_none());
    }
    #[test]
    fn extra_diagnostic_source_anchor_is_exact_and_fail_closed() {
        let original = zephium_agentic::SEMANTIC_RUNTIME_PROGRAM.installation_source();
        assert!(super::super::source(original).is_some());
        assert!(super::super::source(&original.replace(
            "const linkProofs=new WeakMap()",
            "const changedProofs=new WeakMap()"
        ))
        .is_none());
    }
    #[test]
    fn cache_is_bounded_and_evicted_sources_are_unavailable() {
        let mut cache = Cache(VecDeque::new());
        for i in 0..65u64 {
            cache.insert(&i, 1, 1, [0; 32], vec![row(1)]);
        }
        assert_eq!(cache.0.len(), 64);
        assert!(cache.lookup(&0, 1, 1, 1).is_none());
        assert!(cache.lookup(&64, 1, 1, 1).is_some());
    }
    #[test]
    fn maximum_name_envelope_and_default_work_wire_fit_unchanged_channel_bound() {
        use zephium_agentic::{
            SemanticRuntimeBudget, MAX_SEMANTIC_RUNTIME_CHANNEL_RESULT_BYTES,
            SEMANTIC_RUNTIME_CHANNEL_RESULT_PREFIX,
        };
        let flags = 8 | (15 << 4) | (10 << 8) | (15 << 12) | (13 << 16) | (26 << 20) | (15 << 25);
        let ancestor =
            7 | (48 << 3) | (3 << 9) | (2 << 11) | (63 << 13) | (2 << 19) | (26 << 21) | (15 << 26);
        let rows: Vec<_> = (0..32u64)
            .map(|i| serde_json::json!([9_007_199_254_740_991u64 - i, flags, vec![ancestor; 8]]))
            .collect();
        let header = format!(
            "MN1:{}\nMD1:4,1536,16385,48\n",
            serde_json::to_string(&rows).unwrap()
        );
        assert!(header.len() < 4096);
        let mut original = b"{}".to_vec();
        original.resize(
            SemanticRuntimeBudget::WHOLE_PAGE.max_wire_bytes() as usize,
            b' ',
        );
        let mut wire = header.into_bytes();
        wire.extend_from_slice(&original);
        assert!(
            wire.len() + SEMANTIC_RUNTIME_CHANNEL_RESULT_PREFIX.len()
                < MAX_SEMANTIC_RUNTIME_CHANNEL_RESULT_BYTES
        );
        let (rows, md_body) = split(&wire).unwrap();
        let (_, body) = super::super::split(md_body).unwrap();
        assert_eq!(rows.0.len(), 32);
        assert_eq!(body, original);
    }

    #[test]
    fn envelope_is_numeric_bounded_and_original_body_is_borrowed_exactly() {
        let bytes = b"MN1:[[4,0,[0]]]\nMD1:0,1,2,3\n{\"v\":1}";
        let (rows, body) = split(bytes).unwrap();
        assert_eq!(rows.0.len(), 1);
        assert_eq!(body, b"MD1:0,1,2,3\n{\"v\":1}");
        assert!(std::ptr::eq(
            body.as_ptr(),
            bytes[bytes.len() - body.len()..].as_ptr()
        ));
        for bad in [
            "MN1:[[0,0,[]]]\nMD1:",
            "MN1:[[1,536870912,[]]]\nMD1:",
            "MN1:[[1,28311552,[]]]\nMD1:",
            "MN1:[[1,301989888,[]]]\nMD1:",
            "MN1:[[1,0,[1073741824]]]\nMD1:",
            "MN1:[[1,0,[65011712]]]\nMD1:",
            "MN1:[[1,0,[603979776]]]\nMD1:",
            "MN1:[[1,0,[]],[1,0,[]]]\nMD1:",
            "MN1:[[1,\"secret\",[]]]\nMD1:",
        ] {
            assert!(split(bad.as_bytes()).is_none());
        }
    }
}

pub(super) fn instrument(source: &str) -> Option<String> {
    let replacements = [
        (
            r###"let md=[0,0,0,0],mr=[0,0,0,0];"###,
            r###"let ma=new WeakMap(),mn=[],md=[0,0,0,0],mr=[0,0,0,0];"###,
        ),
        (
            r###"function evidence(records, invocation, generation, helpers) {md=[0,0,0,0];"###,
            r###"function evidence(records, invocation, generation, helpers) {md=[0,0,0,0];mn=[];ma=new WeakMap();"###,
        ),
        (
            r###"    const linkProofs=new WeakMap(),provenNames=new Set();"###,
            r###"    const pd=new Map(),pg=new Map(),pb=new WeakMap(),pl=new WeakMap();
    const priority=[...records.filter(r=>r.wire.r==="heading" && r.wire.l===1),...records.filter(r=>r.wire.r==="heading" && r.wire.l!==1),...records.filter(r=>r.wire.r!=="heading")];
    for(const r of priority)if(pd.size<32 && ["heading","link","paragraph"].includes(r.wire.r) && r.sensitivity!=="secret")pd.set(r.wire.k,[0,15,0,15,0]);
    const mark=(r,at,reason,depth)=>{const d=pd.get(r.wire.k);if(d){d[at]=reason;d[at+1]=Math.min(8,depth);}};
    const linkProofs=new WeakMap(),provenNames=new Set();"###,
        ),
        (
            r###"const node=stack.pop();if(++visited>64 || ++work>16384)return false;"###,
            r###"const node=stack.pop();if(++visited>64 || ++work>16384){pl.set(root,work>16384?13:10);return false;}"###,
        ),
        (
            r###"if(node.shadowRoot || tag.includes("-") || ["iframe","frame","object","embed"].includes(tag))return false;"###,
            r###"if(node.shadowRoot || tag.includes("-") || ["iframe","frame","object","embed"].includes(tag)){pl.set(root,node.shadowRoot?7:tag.includes("-")?9:8);return false;}"###,
        ),
        (
            r###"else if(["img","video","canvas","svg"].includes(tag) || style(node).backgroundImage!=="none")return false;"###,
            r###"else if(["img","video","canvas","svg"].includes(tag) || style(node).backgroundImage!=="none"){pl.set(root,6);return false;}"###,
        ),
        (
            r###"const css=style(node,part);if(css.backgroundImage!=="none" || css.content.includes("url("))return false;"###,
            r###"const css=style(node,part);if(css.backgroundImage!=="none" || css.content.includes("url(")){pl.set(root,11);return false;}"###,
        ),
        (
            r###"for(const child of node.childNodes){if(stack.length>=64)return false;stack.push(child);}"###,
            r###"for(const child of node.childNodes){if(stack.length>=64){pl.set(root,10);return false;}stack.push(child);}"###,
        ),
        (
            r###"      return found;"###,
            r###"      pl.set(root,found?1:12);return found;"###,
        ),
        (
            r###"    const cardBoundary=element=>{"###,
            r###"    const cardBoundary=element=>{const value=cardBoundaryRaw(element);pb.set(element,value);return value;};
    const cardBoundaryRaw=element=>{"###,
        ),
        (
            r###"      let parent=record.element;
      for(let depth=0;"###,
            r###"      mark(record,0,6,8);let parent=record.element;
      for(let depth=0;"###,
        ),
        (
            r###"if(nodeType(parent)!==1 || ["html","body","main","nav","header","footer","aside"].includes(tagName(parent)))break;"###,
            r###"if(nodeType(parent)!==1 || ["html","body","main","nav","header","footer","aside"].includes(tagName(parent))){mark(record,0,2,depth);break;}"###,
        ),
        (
            r###"        if((counts.get(parent)||0)>1)break;"###,
            r###"        if((counts.get(parent)||0)>1){mark(record,0,3,depth);break;}"###,
        ),
        (
            r###"        if(related.length) {"###,
            r###"        if(pd.has(record.wire.k)){let slots=pg.get(record.wire.k);if(!slots)pg.set(record.wire.k,slots=new WeakMap());slots.set(parent,related.length);}
        if(related.length) {mark(record,0,1,depth);"###,
        ),
        (
            r###"          const owned=imageOwners.get(record.element);"###,
            r###"          const owned=imageOwners.get(record.element);
          if(links.has(record.element))pl.set(record.element,!record.wire.u?2:owned?.length!==1?3:owned[0]!==visual?4:visuals!==1?5:0);"###,
        ),
        (
            r###"        if(cardBoundary(parent))break;"###,
            r###"        if(cardBoundary(parent)){mark(record,0,4,depth);break;}"###,
        ),
        (
            r###"      if(record.wire.r!=="paragraph" || record.sensitivity==="secret" || provenNames.has(record.wire.k))continue;"###,
            r###"      if(record.wire.r!=="paragraph" || record.sensitivity==="secret" || provenNames.has(record.wire.k)){if(provenNames.has(record.wire.k))mark(record,2,2,0);continue;}
      mark(record,2,9,8);"###,
        ),
        (
            r###"if(nodeType(parent)!==1 || ["html","body","main","nav","header","footer","aside","article","li"].includes(tagName(parent)) || parent.getAttribute("role")==="listitem" || (counts.get(parent)||0)>1)break;"###,
            r###"if(nodeType(parent)!==1 || ["html","body","main","nav","header","footer","aside","article","li"].includes(tagName(parent)) || parent.getAttribute("role")==="listitem" || (counts.get(parent)||0)>1){mark(record,2,4,depth);break;}"###,
        ),
        (
            r###"          const proof=linkProofs.get(parent);"###,
            r###"          const proof=linkProofs.get(parent);mark(record,2,5,depth);const d=pd.get(record.wire.k);if(d)d[4]=pl.get(parent)||0;"###,
        ),
        (
            r###"if(row.r.length<8 && inside(box,record.wire.b) && inside(box,images[proof.index].wire.b))row.r.push(record.wire.k);"###,
            r###"if(row.r.length<8 && inside(box,record.wire.b) && inside(box,images[proof.index].wire.b)){row.r.push(record.wire.k);mark(record,2,1,depth);}else mark(record,2,row.r.length>=8?7:6,depth);"###,
        ),
        (
            r###"const siblings=parent.parentElement;if(work>16384 || !siblings || siblings.children.length>64)break;"###,
            r###"const siblings=parent.parentElement;if(work>16384 || !siblings || siblings.children.length>64){mark(record,2,work>16384?10:4,depth);break;}"###,
        ),
        (
            r###"          if(separate)break;"###,
            r###"          if(separate){mark(record,2,8,depth);break;}"###,
        ),
        (
            r###"    md[2]=Math.min(work,16385);md[3]=rows.length;remember(invocation,generation,records,rows);"###,
            r###"    // Independent diagnostic work is bounded and never debits or resets producer work.
    const lc=new WeakMap(),lr=new WeakMap();let lw=0,lcComplete=true;
    linkIndex:for(const r of records)if(r.wire.r==="link"){
      let n=r.element,d=0;for(;d<64 && n && nodeType(n)===1;d++,n=read(nodeParentGetter,n)){
        if(++lw>2048){lcComplete=false;break linkIndex;}lc.set(n,Math.min(2,(lc.get(n)||0)+1));if(lc.get(n)===1)lr.set(n,r);else lr.delete(n);
      }
      if(d===64 && n){lcComplete=false;break linkIndex;}
    }
    const labels=new WeakMap(),targetCounts=new WeakMap();let labelWork=0;
    const labelRelation=(r,n)=>{try{
      const link=lcComplete?lr.get(n):null;if(!link?.wire.u)return [16,15];
      let memo=labels.get(r.element);if(!memo)labels.set(r.element,memo=new WeakMap());
      if(memo.has(link.element))return memo.get(link.element);
      const value=link.element.getAttribute("aria-labelledby")||"";
      if(value.length>256)return [17,15];const ids=value.trim()?value.trim().split(/\s+/):[];
      if(ids.length>8)return [18,15];if(new Set(ids).size!==ids.length)return [20,ids.length];
      const scope=link.element.getRootNode();
      if(scope!==document && !(scope.nodeType===11 && scope.host?.ownerDocument===document) || typeof scope.getElementById!=="function")return [26,ids.length];
      let mask=0,simple=true;
      const up=(node,wanted)=>{for(let i=0;i<8 && node;i++,node=read(nodeParentGetter,node)){if(++labelWork>4096)return -2;if(node===wanted)return 1;}return node?-1:0;};
      for(const id of ids){
        if(++labelWork>4096){mask=22;break;}const target=scope.getElementById(id);if(!target){mask=19;break;}
        let relation=target===r.element?1:0;
        if(!relation){
          const ancestor=up(r.element,target);if(ancestor===-2){mask=22;break;}
          if(ancestor===1)relation=2;
          else {const descendant=up(target,r.element);if(descendant===-2){mask=22;break;}
            if(descendant===1)relation=4;else if(ancestor===-1 || descendant===-1){mask=21;break;}}
        }
        if(!relation)continue;
        // Count duplicate DOM targets only under the same remaining diagnostic
        // work bound. Never infer uniqueness from a truncated observation.
        let unique=targetCounts.get(target);
        if(unique===undefined){
          const walker=document.createTreeWalker(scope,1);let node,count=0;unique=0;
          while((node=walker.nextNode())){
            if(++labelWork>4096){unique=22;break;}
            if(node.getAttribute("id")===id && ++count>1){unique=25;break;}
          }
          if(!unique && count!==1)unique=19;targetCounts.set(target,unique);
        }
        if(unique){mask=unique;break;}mask|=relation;
        const stack=[target];let visits=0;
        while(stack.length){
          const node=stack.pop();if(++labelWork>4096){mask=22;break;}if(++visits>64){mask=23;break;}
          if(nodeType(node)===3)continue;if(nodeType(node)!==1){simple=false;break;}
          if(node.shadowRoot || node.getAttribute("contenteditable")!==null || node!==target && !["span","b","strong","em","i","small","s","u","abbr","mark","wbr"].includes(tagName(node))){simple=false;break;}
          for(const child of node.childNodes){if(stack.length>=64){mask=23;break;}stack.push(child);}if(mask>=16)break;
        }
        if(mask>=16)break;
      }
      if(mask && mask<16 && simple)mask|=8;const result=[mask,ids.length];memo.set(link.element,result);return result;
    }catch(_){return [24,15];}};
    for(const r of records){const d=pd.get(r.wire.k);if(!d)continue;const a=[];let n=r.element;
      for(let depth=0;depth<8 && n && nodeType(n)===1;depth++,n=read(nodeParentGetter,n)){
        const tag=tagName(n),role=n.getAttribute("role");
        const kind=["html","body","main","nav","header","footer","aside"].includes(tag)?1:tag==="article"?2:tag==="li"||role==="listitem"?3:links.has(n)?4:["div","section","figure"].includes(tag)?5:tag.includes("-")?6:["iframe","frame","object","embed"].includes(tag)?7:0;
        const owned=Math.min(48,(imageOwners.get(n)||[]).length),geo=pg.get(r.wire.k)?.get(n)??63;
        const relation=labelRelation(r,n);a.push(kind|(owned<<3)|((lcComplete?(lc.get(n)||0):3)<<9)|((counts.get(n)||0)<<11)|(geo<<13)|((pb.has(n)?pb.get(n)?2:1:0)<<19)|(relation[0]<<21)|(relation[1]<<26));
      }
      if(work>16384){if(d[0]===6)d[0]=7;if(d[2]===9)d[2]=10;}
      mn.push([r.wire.k,d[0]|d[1]<<4|d[2]<<8|d[3]<<12|d[4]<<16|((ma.get(r.element)||0)<<20),a]);
    }
    md[2]=Math.min(work,16385);md[3]=rows.length;remember(invocation,generation,records,rows);"###,
        ),
        (
            r###"Object.freeze({evidence,invoke,diagnostic:()=>md})"###,
            r###"Object.freeze({evidence,invoke,diagnostic:()=>md,nameDiagnostic:()=>mn})"###,
        ),
        (
            r###"  function mediaEvidence(records, request) {"###,
            r###"  function mediaEvidence(records, request) {mediaNameDiagnostic=[];"###,
        ),
        (
            r###"  let mediaDiagnostic=[0,0,0,0];"###,
            r###"  let mediaDiagnostic=[0,0,0,0],mediaNameDiagnostic=[];"###,
        ),
        (
            r###"mediaDiagnostic=globalThis.__zephiumRecordMediaV1.diagnostic();return result;"###,
            r###"mediaDiagnostic=globalThis.__zephiumRecordMediaV1.diagnostic();mediaNameDiagnostic=globalThis.__zephiumRecordMediaV1.nameDiagnostic();return result;"###,
        ),
        (
            r###"return 'MD1:'+mediaDiagnostic.join(',')+'\n'+encoded.value;"###,
            r###"return 'MN1:'+JSON.stringify(mediaNameDiagnostic)+'\nMD1:'+mediaDiagnostic.join(',')+'\n'+encoded.value;"###,
        ),
    ];
    let start = source.find("function ariaRecordProof(")?;
    let end = source[start..].find("\n  function evidence(")? + start;
    let body = &source[start..end];
    let aria_replacements = [
        (
            r###"  const name = nameRecord.element;"###,
            r###"  const name = nameRecord.element;let ar=1,ad=15;try{"###,
        ),
        (
            r###"      if (++seen > limit || !charge()) return false;"###,
            r###"      if (++seen > limit){ar=20;return false;}if(!charge()){ar=19;return false;}"###,
        ),
        (
            r###"        if (stack.length >= limit) return false;"###,
            r###"        if (stack.length >= limit){ar=20;return false;}"###,
        ),
        (
            r###"  if (!walk(name,32,node=>{"###,
            r###"  ar=2;if (!walk(name,32,node=>{"###,
        ),
        (
            r###"  if (!cache.ids) {"###,
            r###"  ar=3;if (!cache.ids) {"###,
        ),
        (
            r###"    if (!charge() || ['html','body','main','nav','header','footer','aside','article','li'].includes(root.localName)"###,
            r###"    ar=4;ad=depth;if (!charge() || ['html','body','main','nav','header','footer','aside','article','li'].includes(root.localName)"###,
        ),
        (
            r###"    if (!walk(root,64,node => {"###,
            r###"    ar=5;if (!walk(root,64,node => {"###,
        ),
        (
            r###"    if (visuals.length!==1 || links.length!==1) return null;"###,
            r###"    ar=6;if (visuals.length!==1 || links.length!==1) return null;"###,
        ),
        (
            r###"    if (labelled.length!==1"###,
            r###"    ar=7;if (labelled.length!==1"###,
        ),
        (
            r###"    if (!imageRecord || !linkRecord"###,
            r###"    ar=8;if (!imageRecord || !linkRecord"###,
        ),
        (
            r###"    if (image.width<64"###,
            r###"    ar=9;if (image.width<64"###,
        ),
        (
            r###"    let content=visual.parentElement;"###,
            r###"    ar=10;let content=visual.parentElement;"###,
        ),
        (
            r###"    let branch=visual;"###,
            r###"    ar=11;let branch=visual;"###,
        ),
        (
            r###"    if (texts.some("###,
            r###"    ar=12;if (texts.some("###,
        ),
        (
            r###"    if (!peers || peers.length"###,
            r###"    ar=13;if (!peers || peers.length"###,
        ),
        (
            r###"    let repeated=false;"###,
            r###"    ar=14;let repeated=false;"###,
        ),
        (
            r###"    return {name,link,root,visual,imageRecord,linkRecord,id:name.id,href:link.href};"###,
            r###"    ar=15;return {name,link,root,visual,imageRecord,linkRecord,id:name.id,href:link.href};"###,
        ),
        (
            r###"  return null;
}"###,
            r###"  ar=18;return null;
}catch(error){ar=17;throw error;}finally{ma.set(name,ar|(ad<<5));}
}"###,
        ),
        (
            r###"if (node.nodeValue.length>2048) return false;"###,
            r###"if (node.nodeValue.length>2048){ar=25;return false;}"###,
        ),
        (
            r###"if (node.shadowRoot || tag.includes('-') || ['iframe','frame','object','embed','input','textarea','select','button'].includes(tag) || node.isContentEditable) return false;"###,
            r###"if(node.shadowRoot || tag.includes('-') || ['iframe','frame','object','embed'].includes(tag)){ar=22;return false;}if(['input','textarea','select','button'].includes(tag)){ar=21;return false;}if(node.isContentEditable){ar=26;return false;}"###,
        ),
        (
            r###"if (node!==root && (['article','li'].includes(tag) || node.getAttribute('role')==='listitem')) return false;"###,
            r###"if (node!==root && (['article','li'].includes(tag) || node.getAttribute('role')==='listitem')){ar=23;return false;}"###,
        ),
        (
            r###"if (p.backgroundImage!=='none' || p.content.includes('url(')) return false;"###,
            r###"if (p.backgroundImage!=='none' || p.content.includes('url(')){ar=24;return false;}"###,
        ),
    ];
    let mut body = body.to_owned();
    for (from, to) in aria_replacements {
        if body.matches(from).count() != 1 {
            return None;
        }
        body = body.replacen(from, to, 1);
    }
    let mut result = source.to_owned();
    result.replace_range(start..end, &body);
    for (from, to) in replacements {
        if result.matches(from).count() != 1 {
            return None;
        }
        result = result.replacen(from, to, 1);
    }
    (result.len() <= source.len() + 8192).then_some(result)
}
