import UIKit
import Joryio

// MARK: - Base Message View

class BaseMessageView: UIView {
    let campaign: InAppCampaign
    weak var delegate: InAppMessageViewDelegate?

    init(campaign: InAppCampaign, delegate: InAppMessageViewDelegate?) {
        self.campaign = campaign
        self.delegate = delegate
        super.init(frame: .zero)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func show() {
        alpha = 0
        UIView.animate(withDuration: 0.3) {
            self.alpha = 1
        } completion: { _ in
            self.delegate?.messageViewDidAppear(self.campaign.id)
        }
    }

    func dismiss() {
        UIView.animate(withDuration: 0.3) {
            self.alpha = 0
        } completion: { _ in
            self.removeFromSuperview()
            self.delegate?.messageViewDidDismiss(self.campaign.id)
        }
    }
}
