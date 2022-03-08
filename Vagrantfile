Vagrant.configure("2") do |config|
  config.vm.box = "bento/ubuntu-20.04"

  config.vm.synced_folder "vagrant/bin/", "/host/bin",
        mount_options: ["dmode=775,fmode=777"]

  config.vm.provider "virtualbox" do |v|
    v.memory = 2048
  end

  config.vm.provision "shell", inline: <<-SHELL

    # Basic utils
    apt-get update -qqy jq

    # Microk8s
    snap install microk8s --classic --channel=1.18/stable
    microk8s enable dns storage ingress registry

    # Docker
    if ! which docker &>/dev/null; then
        curl -fsSL https://get.docker.com | sh
    fi

    if ! getent group docker &>/dev/null; then
        groupadd docker
    fi

    # Environment
    rm /etc/environment
    ln -s /vagrant/vagrant/environment /etc/environment
    chmod 0644 /etc/environment

  SHELL

  config.vm.provision "shell", privileged: false, inline: <<-SHELL
    # Microk8s
    sudo usermod -a -G microk8s $USER
    sudo chown -f -R $USER ~/.kube

    # Docker
    sudo usermod -aG docker $USER
  SHELL
end
