// NextGameView — the "next game" card (upcoming or scheduled). Mirrors the Wear
// NextGameScreen: title, when, field, roster count, and a scrollable player list.

import SwiftUI

struct NextGameView: View {
  @EnvironmentObject var model: WatchModel

  var body: some View {
    let s = model.state
    ScrollView {
      VStack(alignment: .center, spacing: 6) {
        Text("המשחק הקרוב שלך")
          .font(.caption2)
          .foregroundColor(.secondary)

        Text(s?.title ?? "משחק")
          .font(.headline)
          .multilineTextAlignment(.center)
          .lineLimit(2)
          .minimumScaleFactor(0.6)

        if s?.kind == .scheduled, let opens = s?.registrationOpensAt {
          Label(whenText(opens), systemImage: "lock.fill")
            .font(.caption2)
          Text("ההרשמה תיפתח")
            .font(.caption2)
            .foregroundColor(.secondary)
        } else if let start = s?.startsAt {
          Label(whenText(start), systemImage: "calendar")
            .font(.caption2)
        }

        if let field = s?.fieldName, !field.isEmpty {
          Label(field, systemImage: "mappin.and.ellipse")
            .font(.caption2)
            .lineLimit(1)
        }

        if let count = s?.playersCount, let max = s?.maxPlayers, max > 0 {
          Text("שחקנים \(count)/\(max)")
            .font(.caption)
            .foregroundColor(.blue)
        }

        if let players = s?.players, !players.isEmpty {
          Divider()
          ForEach(players) { p in
            HStack {
              Text(p.name).font(.caption2).lineLimit(1)
              Spacer()
            }
          }
        }
      }
      .padding(.horizontal, 8)
    }
  }

  private func whenText(_ ms: Double) -> String {
    let date = Date(timeIntervalSince1970: ms / 1000)
    let f = DateFormatter()
    f.locale = Locale(identifier: "he_IL")
    f.dateFormat = "EEEE HH:mm"
    return f.string(from: date)
  }
}
