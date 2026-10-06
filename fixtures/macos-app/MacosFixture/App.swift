import FixtureKit
import SwiftUI

@main
struct MacosFixtureApp: App {
  var body: some Scene {
    WindowGroup { Text(FixtureKit.greeting()) }
  }
}
