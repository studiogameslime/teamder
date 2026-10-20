import React from 'react';
import { TextInput as NativeTextInput, type TextInputProps } from 'react-native';
import { RTL_INPUT_ALIGN } from '../theme';

export type RtlTextInput = NativeTextInput;

/** Preserve native editing, callbacks and refs; align Hebrew form fields physically right. */
export const RtlTextInput = React.forwardRef<NativeTextInput, TextInputProps>(
  function RtlTextInput(props, ref) {
    return <NativeTextInput {...props} ref={ref} style={[props.style, { textAlign: RTL_INPUT_ALIGN }]} />;
  },
);
