# Base finds this class BY NAME via reflection (see Joryio.discoverInAppPresenter).
# R8 would otherwise strip or rename it in a release build, and the failure mode
# is silent: no crash, no warning, in-app messages simply never display.
-keep class io.joryio.sdk.ui.DefaultInAppMessagePresenter { <init>(...); }
