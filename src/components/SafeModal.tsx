import React from 'react';
import { Modal as NativeModal, type ModalProps } from 'react-native';
import { SafeAreaProvider, SafeAreaInsetsContext, SafeAreaFrameContext } from 'react-native-safe-area-context';
import { SystemSafeArea } from './SystemSafeArea';

/** Native focus/back/dismiss semantics are preserved; content is protected
 * independently of the safe viewport behind this separate native window.
 * Do not seed this provider with the parent's already-consumed zero insets.
 */
export function SafeModal({ children, transparent, ...props }: ModalProps) {
  return (
    <NativeModal {...props} transparent={transparent} statusBarTranslucent navigationBarTranslucent>
      <SafeAreaInsetsContext.Provider value={null}>
        <SafeAreaFrameContext.Provider value={null}>
          <SafeAreaProvider>
            <SystemSafeArea transparent={transparent}>{children}</SystemSafeArea>
          </SafeAreaProvider>
        </SafeAreaFrameContext.Provider>
      </SafeAreaInsetsContext.Provider>
    </NativeModal>
  );
}
