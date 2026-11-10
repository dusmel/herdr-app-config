// Prints "true" when macOS has Herdr's main window on screen. herdr-app draws
// nothing while it is off screen, so `herdr-app shot` would return an old frame.
import CoreGraphics
let all = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as! [[String: Any]]
let main = all
  .filter { ($0["kCGWindowOwnerName"] as? String) == "Herdr" && ($0["kCGWindowLayer"] as? Int) == 0 }
  .max { a, b in
    let area = { (w: [String: Any]) -> Double in let r = w["kCGWindowBounds"] as! [String: Double]; return r["Width"]! * r["Height"]! }
    return area(a) < area(b)
  }
print((main?["kCGWindowIsOnscreen"] as? Bool) ?? false)
