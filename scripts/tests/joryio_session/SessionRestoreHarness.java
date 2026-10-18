import com.google.gson.Gson;
import io.joryio.sdk.core.Logger;
import io.joryio.sdk.core.SessionManager;
import io.joryio.sdk.core.StorageManager;
import io.joryio.sdk.models.SessionInfo;
import io.joryio.sdk.network.WireJson;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.Map;

public final class SessionRestoreHarness {
  private static int passed, failed;
  private static void check(boolean value, String message) {
    if (!value) throw new AssertionError(message);
  }
  private static void test(String name, Runnable run) {
    try { run.run(); passed++; System.out.println("PASS " + name); }
    catch (Throwable error) {
      failed++; System.out.println("FAIL " + name + " " + error.getClass().getSimpleName() + ": " + error.getMessage());
    }
  }
  public static void main(String[] args) {
    Gson gson = WireJson.INSTANCE.getGson();
    String now = WireJson.INSTANCE.formatUtc(new Date());
    String valid = "{\"sessionId\":\"synthetic-session\",\"sessionStart\":\"" + now + "\",\"lastActivity\":\"" + now + "\"}";
    Map<String, String> cases = new LinkedHashMap<>();
    cases.put("missing-activity", "{\"sessionId\":\"synthetic\",\"sessionStart\":\"" + now + "\"}");
    cases.put("null-activity", valid.replace("\"lastActivity\":\"" + now + "\"", "\"lastActivity\":null"));
    cases.put("missing-start", "{\"sessionId\":\"synthetic\",\"lastActivity\":\"" + now + "\"}");
    cases.put("null-start", valid.replace("\"sessionStart\":\"" + now + "\"", "\"sessionStart\":null"));
    cases.put("missing-id", "{\"sessionStart\":\"" + now + "\",\"lastActivity\":\"" + now + "\"}");
    cases.put("null-id", valid.replace("\"synthetic-session\"", "null"));
    cases.put("blank-id", valid.replace("synthetic-session", "   "));
    cases.put("legacy-renamed-fields", "{\"a\":\"synthetic\",\"b\":\"" + now + "\",\"c\":\"" + now + "\"}");
    cases.put("unparseable-activity", valid.replace("\"lastActivity\":\"" + now + "\"", "\"lastActivity\":\"bad-date\""));
    for (Map.Entry<String,String> item : cases.entrySet()) test(item.getKey(), () -> {
      SessionInfo restored = gson.fromJson(item.getValue(), SessionInfo.class);
      check(restored != null, "fixture must reach the real non-null model");
      StorageManager storage = new StorageManager(restored);
      Map<String,String> untouched = new LinkedHashMap<>(storage.unrelated);
      SessionManager manager = new SessionManager(storage, new Logger(), 1800000L);
      check(!manager.getResumedAtLaunch(), "incomplete session cannot be resumed");
      check(storage.writes == 0, "validation must not eagerly write or clear storage");
      String next = manager.getSessionId();
      check(next != null && !next.isBlank(), "next session id must be valid");
      check(next.equals(manager.getSessionId()), "pure reads must preserve the next id");
      check(storage.writes == 0, "pure reads cannot start tracking");
      check(manager.checkAndRenew(), "first permitted activity starts a fresh session");
      check(storage.writes == 1, "one replacement session write");
      check(next.equals(storage.session.getSessionId()), "first activity uses the promised id");
      check(storage.session.getSessionStart() != null && storage.session.getLastActivity() != null, "replacement dates exist");
      check(storage.unrelated.equals(untouched), "identity, consent, pending messages and token remain unchanged");
      check(!manager.checkAndRenew(), "next activity does not start another session");
    });
    test("valid-session-retained", () -> {
      StorageManager storage = new StorageManager(gson.fromJson(valid, SessionInfo.class));
      SessionManager manager = new SessionManager(storage, new Logger(), 1800000L);
      check(manager.getResumedAtLaunch(), "valid current session resumes");
      check(manager.getSessionId().equals("synthetic-session"), "valid id unchanged");
      check(storage.writes == 0, "restore is read-only");
      check(!manager.checkAndRenew(), "valid session is extended, not replaced");
    });
    test("expired-session-existing-behaviour", () -> {
      StorageManager storage = new StorageManager(new SessionInfo("expired", new Date(1), new Date(1)));
      SessionManager manager = new SessionManager(storage, new Logger(), 1800000L);
      check(!manager.getResumedAtLaunch(), "expired remains expired");
      check(storage.writes == 0, "no eager reset");
      check(manager.checkAndRenew() && storage.writes == 1, "activity replaces exactly once");
    });
    test("absent-session-existing-behaviour", () -> {
      StorageManager storage = new StorageManager(null);
      SessionManager manager = new SessionManager(storage, new Logger(), 1800000L);
      check(!manager.getResumedAtLaunch() && storage.writes == 0, "absent session is not eagerly started");
      check(manager.checkAndRenew() && storage.writes == 1, "first activity starts one");
    });
    System.out.println("RESULT passed=" + passed + " failed=" + failed);
    if (failed != 0) System.exit(1);
  }
}
