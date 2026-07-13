// Teamder watch complication — a WidgetKit face shortcut. v1 is a launcher (a
// soccer-ball glyph that opens the watch app on tap). Live timer/next-game text
// is the next iteration and needs an App Group shared with the watch app.

import WidgetKit
import SwiftUI

struct TeamderEntry: TimelineEntry {
  let date: Date
}

struct TeamderProvider: TimelineProvider {
  func placeholder(in context: Context) -> TeamderEntry {
    TeamderEntry(date: Date())
  }
  func getSnapshot(in context: Context, completion: @escaping (TeamderEntry) -> Void) {
    completion(TeamderEntry(date: Date()))
  }
  func getTimeline(in context: Context, completion: @escaping (Timeline<TeamderEntry>) -> Void) {
    // Static launcher for now — no live data source (needs an App Group).
    completion(Timeline(entries: [TeamderEntry(date: Date())], policy: .never))
  }
}

struct TeamderComplicationView: View {
  @Environment(\.widgetFamily) var family

  var body: some View {
    switch family {
    case .accessoryInline:
      Text("Teamder")
    case .accessoryRectangular:
      HStack(spacing: 6) {
        Image(systemName: "soccerball")
        Text("פתח משחק")
      }
    default: // accessoryCircular / accessoryCorner
      ZStack {
        AccessoryWidgetBackground()
        Image(systemName: "soccerball")
          .font(.title3)
      }
    }
  }
}

@main
struct TeamderComplication: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "TeamderComplication", provider: TeamderProvider()) { _ in
      TeamderComplicationView()
    }
    .configurationDisplayName("Teamder")
    .description("פתח את Teamder על היד")
    .supportedFamilies([.accessoryCircular, .accessoryInline, .accessoryRectangular])
  }
}
