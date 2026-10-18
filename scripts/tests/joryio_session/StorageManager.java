package io.joryio.sdk.core;

import io.joryio.sdk.models.SessionInfo;
import java.util.LinkedHashMap;
import java.util.Map;

/** JVM boundary only. The production SessionManager bytecode is unchanged. */
public final class StorageManager {
  public SessionInfo session;
  public int writes;
  public final Map<String, String> unrelated = new LinkedHashMap<>();
  public StorageManager(SessionInfo session) {
    this.session = session;
    unrelated.put("identity", "synthetic-owner");
    unrelated.put("consent", "denied");
    unrelated.put("outbox", "synthetic-unsent-message");
    unrelated.put("push", "synthetic-token");
  }
  public SessionInfo getSession() { return session; }
  public void setSession(SessionInfo value) { session = value; writes++; }
  public void clearSession() { session = null; writes++; }
}
