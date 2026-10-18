import { createContext, useContext } from 'react';

export const FORM_BLUE = '#2463F5';
export const FORM_BG = '#F5F8FD';
export const FormDesignContext = createContext(false);
export const useFormDesign = () => useContext(FormDesignContext);
export const formFieldStyle = { backgroundColor: '#FFFFFF', borderColor: '#C9D6E9', borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, minHeight: 48 } as const;

