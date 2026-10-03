import Foundation

/// Mirrors the structural checks in src/project/codec.ts; never normalizes or prunes
/// unknown fields. Native entry validates too, even if the TS adapter already did.
enum ProjectValidation {
    private static func number(_ v: Any) -> Bool {
        guard let n = v as? NSNumber else { return false }
        return String(cString: n.objCType) != "c" && n.doubleValue.isFinite
    }
    private static func boolean(_ v: Any) -> Bool {
        guard let n = v as? NSNumber else { return false }
        return String(cString: n.objCType) == "c"
    }
    private static func string(_ v: Any) -> Bool { v is String }
    private static func oneOf(_ choices: [String]) -> (Any) -> Bool { { choices.contains($0 as? String ?? "") } }
    private static func fields(_ p: [String: Any], _ keys: [String], _ check: (Any) -> Bool) -> Bool {
        keys.allSatisfy { p[$0].map(check) ?? true }
    }
    private static func strings(_ v: Any) -> Bool { (v as? [Any])?.allSatisfy(string) ?? false }
    private static func position(_ v: Any) -> Bool {
        guard let p = v as? [String: Any], let x = p["x"], let y = p["y"] else { return false }
        return number(x) && number(y)
    }
    private static func array(_ v: Any?, _ check: ([String: Any]) -> Bool) -> Bool {
        guard let value = v else { return true }
        guard let items = value as? [[String: Any]] else { return false }
        return items.allSatisfy(check)
    }
    private static func map(_ v: Any?, _ check: (Any) -> Bool) -> Bool {
        guard let value = v, !(value is NSNull) else { return true }
        return (value as? [String: Any])?.values.allSatisfy(check) ?? false
    }
    private static func optionalObject(_ v: Any?, _ check: ([String: Any]) -> Bool) -> Bool {
        guard let value = v, !(value is NSNull) else { return true }
        guard let p = value as? [String: Any] else { return false }
        return check(p)
    }
    static func valid(_ p: [String: Any]) -> Bool {
        guard fields(p, ["title","createdAt","updatedAt","lastOpenedAt","focusMemberId"], string),
              fields(p, ["version","stageWidthM","stageHeightM","stageDepthM","widthM","heightM","depthM","gridIntervalM","memberCircleDiameterM"], number),
              fields(p, ["mode"], oneOf(["stage","parade"])), fields(p, ["viewerPerspective"], oneOf(["audience","performer"])),
              fields(p, ["useGlobalStageSize","useGlobalStageWidth","fixedForAllScenes"], boolean) else { return false }
        guard optionalObject(p["stage"], { s in
            fields(s, ["widthMeters","depthMeters","gridSizeMeters","memberDiameterMeters","stageWidthM","stageHeightM","widthM","heightM","depthM","gridIntervalM","memberCircleDiameterM"], number) &&
            fields(s, ["showGrid","showCenterLine","showStageLabels","showCenterMarker","fixedForAllScenes","centerSplitBandEnabled","coneGuideEnabled"], boolean) &&
            fields(s, ["audienceSide"], oneOf(["bottom","top"])) && fields(s, ["frontDirection"], oneOf(["bottom","top","left","right"])) &&
            fields(s, ["originMode"], oneOf(["topLeft","center","audienceCenter"])) && fields(s, ["horizontalGuideMode","horizontalDisplayMode"], oneOf(["meters","centerSplit"]))
        }), optionalObject(p["paradeSettings"], { s in
            fields(s, ["totalDistance","width","cellSizeMeters","backwardDistanceMeters"], number) && fields(s, ["emphasizeEvery5m","emphasizeEvery10m"], boolean) &&
            fields(s, ["direction"], oneOf(["up"])) && fields(s, ["rulerPosition"], oneOf(["both","left","right","none"])) && fields(s, ["horizontalMeasureMode"], string)
        }), optionalObject(p["audio"], { s in
            s["name"] is String && s["type"] is String && s["size"].map(number) == true && fields(s, ["duration"], number)
        }) else { return false }
        guard array(p["members"], { m in
            m["id"] is String && m["name"] is String && m["color"] is String && fields(m, ["visible"], boolean) && fields(m, ["zIndex"], number)
        }), array(p["stageObjects"], { o in
            o["id"] is String && o["name"] is String && o["color"] is String &&
            o["type"].map(oneOf(["prop","setPiece","chair","table","panel","curtain","mark","area","custom"])) == true &&
            o["shape"].map(oneOf(["rectangle","circle","line","curtain","custom"])) == true &&
            fields(o, ["visible","locked"], boolean) && fields(o, ["widthMeters","heightMeters","defaultX","defaultY","defaultRotation","zIndex"], number)
        }), array(p["frames"], { f in
            f["id"] is String && f["label"] is String && f["timeSec"].map(number) == true && fields(f, ["section","notes"], string) &&
            map(f["positions"], position) && map(f["objectStates"], { value in
                guard let s = value as? [String: Any] else { return false }
                return s["objectId"] is String && s["visible"].map(boolean) == true && ["x","y","widthMeters","heightMeters","rotation","zIndex"].allSatisfy { s[$0].map(number) == true }
            }) && map(f["memberVisibility"], boolean) && map(f["groupVisibility"], boolean) && map(f["objectAssignments"], strings) &&
            map(f["memberAppearanceOverrides"], { v in (v as? [String: Any]).map { fields($0, ["color"], string) } ?? false }) &&
            fields(f, ["stageWidthMeters","stageDepthMeters"], number) && optionalObject(f["sceneViewState"], { fields($0, ["scrollTop","scrollLeft","zoom","viewportHeight","viewportWidth"], number) })
        }) else { return false }
        guard array(p["memberGroups"], { $0["id"] is String && $0["memberIds"].map(strings) == true && fields($0, ["name","color"], string) }),
              array(p["objectGroups"], { $0["id"] is String && $0["objectIds"].map(strings) == true && fields($0, ["name","color","defaultType","defaultShape"], string) }),
              array(p["movementPaths"], { s in
                fields(s, ["id","targetId","memberId","targetType","fromFrameId","toFrameId","pathType","type"], string) && fields(s, ["visible"], boolean) && (s["controlPoint"].map(position) ?? true)
              }), array(p["movementPlans"], { s in
                ["targetId","targetType","fromFrameId","toFrameId"].allSatisfy { s[$0] is String } && fields(s, ["id","pathType","note"], string) && fields(s, ["enabled"], boolean) &&
                fields(s, ["startSec","endSec"], number) && (s["controlPoint"].map(position) ?? true) && (s["waypoints"].map { ($0 as? [Any])?.allSatisfy(position) ?? false } ?? true)
              }), optionalObject(p["animationSettings"], { fields($0, ["membersEnabled","objectsEnabled","curtainsEnabled"], boolean) }),
              optionalObject(p["guideSettings"], { fields($0, ["snapGuideEnabled","snapToGuideEnabled"], boolean) }) else { return false }
        return true
    }
}
