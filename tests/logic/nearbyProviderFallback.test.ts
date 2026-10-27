jest.mock('react-native',()=>({Linking:{openSettings:jest.fn()}}));
jest.mock('@/components/AppDialog',()=>({appAlert:jest.fn()}));
jest.mock('@/i18n/he',()=>({he:{}}));
jest.mock('@/utils/errorObservation',()=>({observeCaughtError:jest.fn()}));
const mockLocation={Accuracy:{Balanced:3},getForegroundPermissionsAsync:jest.fn(),getCurrentPositionAsync:jest.fn(),reverseGeocodeAsync:jest.fn()};
jest.mock('expo-location',()=>mockLocation);
import {resolveNearbyLocation} from '@/utils/nearby';
import {observeCaughtError} from '@/utils/errorObservation';
beforeEach(()=>{Object.defineProperty(globalThis,'__DEV__',{value:false,configurable:true});jest.useFakeTimers();jest.clearAllMocks();mockLocation.getForegroundPermissionsAsync.mockResolvedValue({granted:true,canAskAgain:true});mockLocation.getCurrentPositionAsync.mockResolvedValue({coords:{latitude:31.8,longitude:34.8}});});
afterEach(()=>{jest.clearAllTimers();jest.useRealTimers();});
test('a disconnected GPS provider cannot turn an already granted permission into a denial',async()=>{
 mockLocation.getCurrentPositionAsync.mockRejectedValue(Object.assign(Error('Google Play services disconnected'),{code:'ERR_LOCATION_REQUEST_REJECTED'}));
 await expect(resolveNearbyLocation('עיר שמורה')).resolves.toMatchObject({latLng:null,city:'עיר שמורה',granted:true,canAskAgain:true});
 expect(jest.getTimerCount()).toBe(0);
});
test('a geocoder that never responds keeps the real GPS fix and releases the loading state',async()=>{
 mockLocation.reverseGeocodeAsync.mockImplementation(()=>new Promise(()=>{}));
 const result=resolveNearbyLocation('עיר שמורה');
 await jest.advanceTimersByTimeAsync(6000);
 await expect(result).resolves.toMatchObject({latLng:{lat:31.8,lng:34.8},city:'עיר שמורה',granted:true});
 expect(jest.getTimerCount()).toBe(0);
});
test('successful location reads leave no expired GPS timeout behind',async()=>{
 mockLocation.reverseGeocodeAsync.mockResolvedValue([{city:'עיר מזוהה'}]);
 await expect(resolveNearbyLocation('עיר שמורה')).resolves.toMatchObject({city:'עיר מזוהה',granted:true});
 expect(jest.getTimerCount()).toBe(0);
});
test('Android missing country code keeps GPS and saved city without a false failure report',async()=>{
 mockLocation.reverseGeocodeAsync.mockRejectedValue(Error('java.lang.NullPointerException: getCountryCode(...) must not be null'));
 await expect(resolveNearbyLocation('עיר שמורה')).resolves.toMatchObject({latLng:{lat:31.8,lng:34.8},city:'עיר שמורה',granted:true});
 expect(observeCaughtError).not.toHaveBeenCalled();
});
test('other reverse geocoder errors remain visible and preserve GPS',async()=>{
 const error=Error('provider unavailable');mockLocation.reverseGeocodeAsync.mockRejectedValue(error);
 await expect(resolveNearbyLocation('עיר שמורה')).resolves.toMatchObject({latLng:{lat:31.8,lng:34.8},city:'עיר שמורה'});
 expect(observeCaughtError).toHaveBeenCalledWith(error,expect.objectContaining({site:'nearby:88fb261f2f'}));
});
